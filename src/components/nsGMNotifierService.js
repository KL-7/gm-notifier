/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Gmail Notifier code.
 *
 * The Initial Developer of the Original Code is
 * Doron Rosenberg.
 * Portions created by the Initial Developer are Copyright (C) 2004 - 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const kGMSERVICE_CONTRACTID = "@mozilla.org/GMailNotifier;1"
const kGMSERVICE_CID = Components.ID("1d024ea4-5432-4831-9241-c99a85a9d2b4");
const nsINotifierService = Components.interfaces.nsIGMNotifierService
const nsINotifierProgressListener = Components.interfaces.nsIGMNotifierProgressListener;
const nsISupports = Components.interfaces.nsISupports;

const kIOSERVICE_CONTRACTID = "@mozilla.org/network/io-service;1";
const nsIIOService = Components.interfaces.nsIIOService;

const nsICookieManager = Components.interfaces.nsICookieManager;
const kCOOKIESERVICE_CONTRACTID = "@mozilla.org/cookieService;1";

const kPSWDMANAGER_CONTRACTID = "@mozilla.org/passwordmanager;1";
const nsIPasswordManagerInternal = Components.interfaces.nsIPasswordManagerInternal;

const kLOGINMANAGER_CONTRACTID = "@mozilla.org/login-manager;1"
const nsILoginManager = Components.interfaces.nsILoginManager;

const kTIMER_CONTRACTID = "@mozilla.org/timer;1";
const nsITimer = Components.interfaces.nsITimer;

const nsIHttpChannel = Components.interfaces.nsIHttpChannel;

function nsNotifierService() {
  // log string
  this.logString = "";
  this.connectionCounter = 0;

  // array of attached listeners
  this.listeners = new Array();
  this.notificationListenerID = null;

  this.userQueue = null;
  this.currentUserQueue = null;

  this.loggedIn = false;
  this.userList = null;
  this.userCount = 0;
  this.loggedInUsers = 0;
  this.multiuser = false;
  this.defaultUser = null;

  this.connectionPhase = null;
  this.isAutoConnecting = false;

  this.prefBranch = null;

  this.updateTimer = null;
  this.timeOut = 600000; // default to 10 mins

  var myThis = this;
  this.PrefChangeObserver = {
    observe: function(aSubject, aTopic, aData)
    {
      myThis.prefChanged(aData);
    }
  };

  this.channel = null;

  this.addPrefObserver("gm-notifier", this.PrefChangeObserver);
  this.observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);

  if (!this.supportsMultiMode()) {
    this.multiuser = false;
  } else {
    this.multiuser = this.getPrefBranch().getBoolPref("gm-notifier.multiaccount.enabled");
  }

  // force logged out
  this.getPrefBranch().setBoolPref("gm-notifier.loggedin", false);

  // can be not set
  try {
    this.defaultUser = this.getPrefBranch().getCharPref("gm-notifier.users.default");
  } catch (e) {}
}

// migrates old-firefox (2.0 and below) stored passwords to the new 3.0 way, 
// which requres a http realm
nsNotifierService.prototype.migrateAccounts = function() {
  var url = "chrome://gm-notifier/";

  var passwordManager = Components.classes[kLOGINMANAGER_CONTRACTID].getService(nsILoginManager);
  var logins = passwordManager.getAllLogins({});
  for (var i = 0; i < logins.length; i++) {
    this.logItem(" :: "+logins[i].hostname + " " + logins[i].httpRealm + " " + logins[i].username);

    if (logins[i].hostname == url && (logins[i].httpRealm == null)) {
      this.logItem(" ---- migrating login");

      var logininfo = Components.classes["@mozilla.org/login-manager/loginInfo;1"].createInstance(Components.interfaces.nsILoginInfo);
      // XXX: FF3 doesn't allow empty/null names - using " ", need to reconsider
      logininfo.init(url, null, "gm-notifier", logins[i].username, logins[i].password ? logins[i].password : " ", "", "");
      passwordManager.modifyLogin(logins[i], logininfo);
    }
  }
}

nsNotifierService.prototype.buildUserList = function() {
  this.userList = new Object();

  // we need to reset notifier prefs for loggedin to false.  This will also
  // transition 0.5.x users to the new pref way
  var url = "chrome://gm-notifier/";

  // check for toolkit's login manager (Mozilla 1.9)
  if (Components.classes[kLOGINMANAGER_CONTRACTID]) {
    var passwordManager = Components.classes[kLOGINMANAGER_CONTRACTID].getService(nsILoginManager);

    var passwords = passwordManager.findLogins({}, url, null, "gm-notifier");
    if (passwords.length == 0) {
      // try to migrate
      this.logItem("no passwords found, lets try to migrate accounts");
      this.migrateAccounts();
    }

    passwords = passwordManager.findLogins({}, url, null, "gm-notifier");

    if (passwords.length > 0) {
      for (var i = 0; i < passwords.length; i++) {
        username = passwords[i].username;

        this.userList[username] = this.newUserListItem(username, null);
        this.getPrefBranch().setBoolPref("gm-notifier.userlist." + username + ".loggedin", false);
      }
    }
  } else {
    var passwordManager = Components.classes[kPSWDMANAGER_CONTRACTID].createInstance();
    if (!passwordManager) {
      return;
    }
    passwordManager = passwordManager.QueryInterface(Components.interfaces.nsIPasswordManager);

    if (!passwordManager) {
      return;
    }

    var enumerator = passwordManager.enumerator;
    while (enumerator.hasMoreElements()) {
      var nextPassword;
      try {
        nextPassword = enumerator.getNext();
      } catch(e) {
        break;
      }
      nextPassword = nextPassword.QueryInterface(Components.interfaces.nsIPassword);
      var host = nextPassword.host;

      if (host == url) {
        // try/catch in case decryption fails (invalid signon entry)
        try {
          var username = nextPassword.user;
          this.userList[username] = this.newUserListItem(username, null);

          this.getPrefBranch().setBoolPref("gm-notifier.userlist." + username + ".loggedin", false);
        } catch (e) {
        }
      }
    }
  }
}

nsNotifierService.prototype.buildUserQueue = function() {
  this.userQueue = new Array();

  // add default user first, if one exists.
  if (this.defaultUser) {
    this.userQueue.push(this.defaultUser);
  }

  // not multi-user, we are done
  if (!this.multiuser) {
    return;
  }

  for (name in this.userList) {
    if (name != this.defaultUser) {
      // only add to the queue if autologin is set to true
      var autologin = false;

      try {
        autologin = this.getPrefBranch().getBoolPref("gm-notifier.userlist." + name + ".autologin");
      } catch (e) {}

      if (autologin) {
        this.userQueue.push(name);
      }
    }
  }
}


/********** Scriptable interfaces ****************/

/**
 * Initiates login
 *
 * @param aUsername
 * @param aPassword
 * @param aListenerID
 */
nsNotifierService.prototype.initLogin = function(aUsername, aPassword, aListenerID) {
  this.logItem("initLogin: aListenerID is " + aListenerID);

  // build user list
  if (!this.userList) {
    this.logItem("initLogin: no user list");
    try {
      this.buildUserList();
    } catch (ex) {
      // master password canceling throws an exception
      this.userList = null;
    }
  }

  if (!this.userList[aUsername])
    this.userList[aUsername] = this.newUserListItem(aUsername, aPassword);
  else {
    this.userList[aUsername].password = aPassword;
  }

  this.notificationListenerID = aListenerID;

  // user queue
  if (!this.multiuser) {
    // single user - one person at a time in the queue
    this.userQueue = new Array();
    this.userQueue.push(aUsername);
  }

  this.checkAccounts();
}

/**
 * Initiates a new mail check
 *
 */
nsNotifierService.prototype.checkNow = function() {
  this.checkAccounts();
}

/**
 * Logs out all users
 *
 */
nsNotifierService.prototype.logout = function() {
  // clear the timer
  if (this.updateTimer) {
    this.updateTimer.cancel();
  }

  this.updateTimer = null;

  // clear the cookie data
  this.clearCookieData();

  // reset all users and log each user out
  for (var username in this.userList) {
    this.userList[username] = this.newUserListItem(username, null);
    this.pushStateChange(username, nsINotifierProgressListener.LOGOUT_USER);
  }

  // clear user queue
  this.userQueue = null;
  this.currentUserQueue = null;
  this.loggedIn = false;
  this.loggedInUsers = 0;

  this.pushStateChange(null, nsINotifierProgressListener.LOGOUT);

  this.getPrefBranch().setBoolPref("gm-notifier.loggedin", false);
}

/**
 * Logs the user out
 *
 */
nsNotifierService.prototype.logoutUser = function(aUsername) {
  if (!this.userList[aUsername]) {
    return;
  }

  // remove from the user queue
  if (this.userQueue) {
    var index =  this.isUserInQueue(aUsername);;
    if (index !== false) {
      this.userQueue.splice(index, 1);
    }
  }
  if (this.userList[aUsername].state == nsINotifierService.USER_STATE_LOGGED_IN) {
    this.userList[aUsername].state = nsINotifierService.USER_STATE_LOGGED_OUT;
    this.loggedInUsers--;
  }

  // logout, so reset the userdata.
  this.userList[aUsername] = this.newUserListItem(aUsername, null);

  // if this was the default user and we have other logged in users, switch
  // default user to first in the queue
  if (this.loggedInUsers > 0) {
    if (this.defaultUser == aUsername) {
      this.getPrefBranch().setCharPref("gm-notifier.users.default", this.userQueue[0]);
    }
  }

  // tell all listeners that we logged out
  this.pushStateChange(aUsername, nsINotifierProgressListener.LOGOUT_USER);

  if (this.loggedInUsers == 0) {
    this.logout();
  }
}

/**
 * Logs the user in
 *
 */
nsNotifierService.prototype.loginUser = function(aUsername) {
  // in not in the user list, new user - such as one being added in the accounts
  // dialog
  if (!this.userList[aUsername]) {
    var password = this.getPassword(aUsername);

    // no password, no go
    if (!password) {
      return;
    }

    this.userList[aUsername] = this.newUserListItem(aUsername, password);
  }

  // add to queue
  if (!this.userQueue) {
    this.userQueue = new Array();
  }

  // if not in the queue, add
  var userQueueIndex = this.isUserInQueue(aUsername);
  if (userQueueIndex === false) {
    this.userQueue.push(aUsername);
    wasInQueue = false;
    userQueueIndex = this.userQueue.length - 1;
  }

  // if already in an accounts check, add to queue
  if (this.currentUserQueue != null) {
    // do nothing really
  } else {
    // clear timer
    if (this.updateTimer) {
      this.updateTimer.cancel();
    }

    // cheat :)
    this.currentUserQueue = userQueueIndex;

    // force this person to be the default user if no logged in users
    if (this.loggedInUsers == 0) {
      this.getPrefBranch().setCharPref("gm-notifier.users.default", aUsername);
    }

    // presto!
    this.accountCheckStart(aUsername);
  }
}

nsNotifierService.prototype.isUserInQueue = function(aUsername) {
  if (!this.userQueue) {
    return false;
  }

  for (var i = 0; i < this.userQueue.length; i++) {
    if (this.userQueue[i] == aUsername) {
      return i;
    }
  }

  return false;

}

/**
 * Loads the user's cookies into the browser
 *
 */
nsNotifierService.prototype.loadUserCookies = function(aUsername) {
  if (!this.userList[aUsername] ||
      this.userList[aUsername].state != nsINotifierService.USER_STATE_LOGGED_IN) {
    return;
  }

  this.loadCookieData(aUsername);
}

nsNotifierService.prototype.loadCookieIntoApp = function(aCookieData) {
  if (!aCookieData) {
    return;
  }

  var cookieManager2 = Components.classes["@mozilla.org/cookiemanager;1"]
                                 .getService(Components.interfaces.nsICookieManager2);

  var index = aCookieData.value.indexOf("=");
  var value = aCookieData.value.substr(index+1);
  //this.logItem("  -- cdata data is: name: "+aCookieData.name+" value:" + value + " for "+aCookieData.domain);

  // 1.9+ added a httpOnly flag
  var isGecko19 = false;

  if (Components.interfaces.nsIXULAppInfo) {
    var appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
    var versionChecker = Components.classes["@mozilla.org/xpcom/version-comparator;1"].getService(Components.interfaces.nsIVersionComparator);

    if (versionChecker.compare(appInfo.platformVersion, "1.9") >= 0) {
      isGecko19 = true;
    }
  }

  //this.logItem(" loading cookie into app: domain:"+ aCookieData.domain+" path: "+(aCookieData.path ? aCookieData.path : "") + " name: " + aCookieData.name+ " value: " + value);
  if (isGecko19) {
    cookieManager2.add(aCookieData.domain, aCookieData.path ? aCookieData.path : "", aCookieData.name, value, false, false, true, Math.pow(2, 62));
  } else {
    cookieManager2.add(aCookieData.domain, aCookieData.path ? aCookieData.path : "", aCookieData.name, value, false, true, Math.pow(2, 62));
  }
}

/**
 * Adds an NotifierListener to this service
 *
 * @param aListener
 */
nsNotifierService.prototype.addListener = function(aListener) {
  // should we autologin?
  // make sure to only check for autologin the first time a listener has been
  // added, ie first browser window calls us.
  if ((this.listeners.length == 0) && this.getPrefBranch() &&
      this.getPrefBranch().getBoolPref("gm-notifier.autologin.enabled")) {
    // autologin
    if (!this.userList) {
      try {
        this.buildUserList();
      } catch (ex) {
        // master password canceling throws an exception
        this.userList = null;
        this.listeners.push(aListener);
        return;
      }
    }

    if (this.userCount > 0) {
      if (!this.defaultUser) {
        // get first user in list
        for (var name in this.userList) {
          this.defaultUser = name;
          break;
        }
      }

      this.isAutoConnecting = true;

      // user queue
      if (!this.multiuser) {
        // single user - one person at a time in the queue
        this.userQueue = new Array();
        this.userQueue.push(this.defaultUser);
      }

      this.checkAccounts();
    }
  }

  this.listeners.push(aListener);

  // for every new listener added, push login state
  if (this.loggedIn) {
    aListener.onStateChange(null, nsINotifierProgressListener.NOTIFIER_LOGGED_IN);
  } else {
    aListener.onStateChange(null, nsINotifierProgressListener.LOGOUT);
  }

  return this.listeners.length;
}

/**
 * Removes an NotifierListener to this service
 *
 * @param aListener
 */
nsNotifierService.prototype.removeListener = function(aListener) {
  var found = false;
  var run = 0;

  while (!found && (run < this.listeners.length)) {
    if (this.listeners[run] == aListener) {
      this.listeners[run] = null;
      found = true;
    }
    run++;
  }
}

/**
 * Gets the reset state.  Reset is set if the user clicks/checks for new mail.
 */
nsNotifierService.prototype.getResetState = function(aUsername) {
  return this.userList[aUsername].resetState;
}

/**
 * Sets the reset state
 *
 * @param aResetState
 */
nsNotifierService.prototype.setResetState = function(aUsername, aResetState) {
  this.userList[aUsername].resetState = aResetState;

  // need to send an event so that the unread count will update.  NEW_MAIL will
  // do for now, XXX: probably should have its own state.
  this.pushStateChange(aUsername, nsINotifierProgressListener.NEW_MAIL);
}

nsNotifierService.prototype.getNewMailMode = function(aUsername) {
  return this.userList[aUsername].newMailMode;
}

nsNotifierService.prototype.setNewMailMode = function(aUsername, aMode) {
  this.userList[aUsername].newMailMode = aMode;

  this.pushStateChange(aUsername, nsINotifierProgressListener.USER_MODE_CHANGED);
}

nsNotifierService.prototype.getInboxUnread = function(aUsername) {
  return this.userList[aUsername].inboxUnread;
}

nsNotifierService.prototype.getUnreadCount = function() {
  return this.userList[aUsername].unreadEmails;
}

nsNotifierService.prototype.getDisplayCount = function(aUsername) {
  if (this.userList[aUsername].resetState) {
    return 0;
  } else {
    if (this.getPrefBranch().getBoolPref("gm-notifier.ui.counter.showInbox")) {
      return this.getInboxUnread(aUsername);
    } else {
      return this.userList[aUsername].unreadEmails;
    }
  }
}

nsNotifierService.prototype.getNewCount = function(aUsername) {
  var value;

  if (this.userList[aUsername].resetState) {
    value = 0;
  } else {
    if (this.getPrefBranch().getBoolPref("gm-notifier.ui.counter.showInbox")) {
      value = this.userList[aUsername].inboxNew;
    } else {
      value = this.userList[aUsername].newEmails;
    }
  }

  return value;
}

nsNotifierService.prototype.getUsedMB = function(aUsername) {
  return this.userList[aUsername].space_used_mb;
}

nsNotifierService.prototype.getSpaceUsed = function(aUsername) {
  return this.userList[aUsername].space_used_percent;
}

nsNotifierService.prototype.getTotalSpace = function(aUsername) {
  return this.userList[aUsername].total_mb;
}

nsNotifierService.prototype.getFolderCount = function(aUsername) {
  return this.userList[aUsername].folders.length;
}

nsNotifierService.prototype.getFolderItem = function(aUsername, aPosition, sizeObj) {
  sizeObj.value = 2;
  return [this.userList[aUsername].folders[aPosition].name, this.userList[aUsername].folders[aPosition].unreadMail];
}

nsNotifierService.prototype.getActiveUserCount = function() {
  return this.loggedInUsers;
}

nsNotifierService.prototype.getUserCount = function() {
  // build the userlist
  if (!this.userList) {
    this.buildUserList();
  }

  return this.userCount;
}

nsNotifierService.prototype.getUserName = function(aUserNum) {
  // make sure aUserNum is valid
  if (aUserNum > this.userCount || aUserNum < 0) {
    return;
  }

  var i = 0;
  var username = "";

  for (userName in this.userList) {
    if (i == aUserNum) {
      break;
    }

    i++;
  }

  return userName;
}

nsNotifierService.prototype.getUserState = function(aUsername) {
  var state = nsINotifierService.USER_STATE_LOGGED_OUT;

  if (this.userList[aUsername]) {
    state = this.userList[aUsername].state;
  }

  return state;
}

nsNotifierService.prototype.removeUser = function(aUsername) {
  if (!aUsername || !this.userList[aUsername]) {
    return;
  }

  // make copy, but without the user to remove
  var newList = new Array();

  function copyObjectData(aObject) {
    var obj = new Object();

    for (item in aObject) {
      if (typeof(item) == "object") {
        obj[item] = copyObjectData(aObject[item]);
      } else {
        obj[item] = aObject[item];
      }
    }

    return obj;
  }

  for (username in this.userList) {
    if (username != aUsername) {
      newList[username] = copyObjectData(this.userList[username]);
    } else {
      this.userCount--;
    }
  }

  this.userList = newList;
}

nsNotifierService.prototype.addUser = function(aUsername) {
  if (this.userList[aUsername]) {
    return;
  }

  this.userList[aUsername] = this.newUserListItem(aUsername, null);
}

nsNotifierService.prototype.getQueueCount = function() {
  if (!this.userQueue) {
    this.buildUserQueue();
  }

  return this.userQueue.length;
}

nsNotifierService.prototype.getQueueUserName = function(aUserNum) {
  // make sure aUserNum is valid
  if (aUserNum > this.userCount || aUserNum < 0) {
    return null;
  }

  return this.userQueue[aUserNum];
}

nsNotifierService.prototype.setTimeout = function(aMinutes) {
  // convert to ms
  this.timeOut = (aMinutes * 60000);

  // set timer only if we are logged in
  if (this.loggedIn) {
    this.setTimer();
  }
}

/**
 * Adds an item to the log
 *
 */
nsNotifierService.prototype.logItem = function(aLogString) {
  this.logString += aLogString + "|||";
}

nsNotifierService.prototype.getLog = function() {
  return this.logString;
}

nsNotifierService.prototype.clearLog = function() {
  this.logString = "";
}

/*************** Private Methods ************/

nsNotifierService.prototype.talkToServer = function(aUsername, aURL, aPostData,
                                                    aCookieData, aReferrer,
                                                    aCallbackFunc) {
  this.logItem("  talkToServer Called ("+aUsername+") with url: "+aURL);
  //dump("\n\nurl: " + aURL);

  // the IO service
  var ioService = Components.classes[kIOSERVICE_CONTRACTID].getService(nsIIOService);

  // create an nsIURI
  var uri = ioService.newURI(aURL, null, null);

  //nsIInputStream
  var uploadStream = Components.classes["@mozilla.org/io/string-input-stream;1"]
    .createInstance(Components.interfaces.nsIStringInputStream);

  if (aPostData) {
    this.logItem("    -- post data is: " + aPostData);
    uploadStream.setData(aPostData, aPostData.length);
  }

  // clean up if old channel exists.  Should never happen really!
  if (this.channel) {
    this.channel.cancel(Components.results.NS_BINDING_ABORTED);
    this.channel = null;
  }

  // get a channel for that nsIURI
  this.channel = ioService.newChannelFromURI(uri);

  // get a httpchannel and make it a post
  var httpChannel = this.channel.QueryInterface(nsIHttpChannel);

  // set a referrer
  if (aReferrer) {
    var referrerUri = ioService.newURI(aReferrer, null, null);
    httpChannel.referrer = referrerUri;
  }

  if (aPostData) {
    var uploadChannel = this.channel.QueryInterface(Components.interfaces.nsIUploadChannel);
    uploadChannel.setUploadStream(uploadStream, "application/x-www-form-urlencoded", -1);

    // order important - setUploadStream resets to get/put
    httpChannel.requestMethod = "POST";
  }

  if (aCookieData){
    // httpChannel.setRequestHeader("Cookie", aCookieData, false);
    this.logItem("    -- cookie data is: " + JSON.toString(aCookieData));
    for (var run = 0; run < aCookieData.length; run++) {
      httpChannel.setRequestHeader("Cookie", aCookieData[run], true);
    }
  }

  var observer = new this.observer(aCallbackFunc, aUsername, this);

  this.channel.notificationCallbacks = observer;
  this.channel.asyncOpen(observer, null);
}

nsNotifierService.prototype.checkAccounts = function() {
  // checks accounts in the userqueue
  if (!this.userQueue) {
    this.buildUserQueue();
  }

  this.currentUserQueue = 0;

  this.pushStateChange(null, nsINotifierProgressListener.ACCOUNTS_CHECK_INITIATED);

  this.accountCheckStart(this.userQueue[0]);
}

nsNotifierService.prototype.accountCheckResult = function(aUsername, aStatus) {
  if (aStatus == nsINotifierProgressListener.LOGIN_DETAILS_INVALID) {
    this.logItem("  Login details were invalid");
    this.userList[aUsername].state = nsINotifierService.USER_STATE_INVALID_DETAILS;

    if (this.userList[aUsername].state != nsINotifierService.USER_STATE_INVALID_DETAILS) {
      if (this.userList[aUsername].state == nsINotifierService.USER_STATE_LOGGED_IN) {
        // if was logged in, remove from logged in user count
        this.loggedInUsers--;
        this.clearCookieObject(aUsername);
        this.getPrefBranch().setBoolPref("gm-notifier.userlist." + aUsername + ".loggedin", false);
      }
    }

  } else if (aStatus == nsINotifierProgressListener.LOGIN_FAILED) {
    this.logItem("  Login connection failed");
    this.userList[aUsername].state = nsINotifierService.USER_STATE_LOGGED_OUT;

    // if user was logged in, log him out.
    if (this.userList[aUsername].state == nsINotifierService.USER_STATE_LOGGED_IN) {
      this.loggedInUsers--;
      this.clearCookieObject(aUsername);
      this.getPrefBranch().setBoolPref("gm-notifier.userlist." + aUsername + ".loggedin", false);
    }
  } else if (aStatus == nsINotifierProgressListener.LOGIN_SUCCESS) {
    // if user was logged out, log him in.
    if (this.userList[aUsername].state == nsINotifierService.USER_STATE_LOGGED_OUT) {
      this.loggedInUsers++;
      this.getPrefBranch().setBoolPref("gm-notifier.userlist." + aUsername + ".loggedin", true);
    }

    this.userList[aUsername].state = nsINotifierService.USER_STATE_LOGGED_IN;
  }

  // if failed to login, check for default user
  if (this.multiuser && aStatus != nsINotifierProgressListener.LOGIN_SUCCESS) {
    if (this.defaultUser == aUsername) {
      // if the default user didn't log in, we switch the default user out.
      if (this.loggedInUsers > 0) {
        // we have a user logged in already
        for (name in this.userQueue) {
          if (this.userList[aUsername].state == nsINotifierService.USER_STATE_LOGGED_IN) {
            this.getPrefBranch().setCharPref("gm-notifier.users.default", name);
            break;
          }
        }
      } else {
        // use the next person, if one exists
        var name = this.userQueue[this.currentUserQueue+1];
        if (name) {
          this.getPrefBranch().setCharPref("gm-notifier.users.default", name);
        }
      }
    }
  } else if (!this.defaultUser && aStatus == nsINotifierProgressListener.LOGIN_SUCCESS) {
    // no default user, make this person it!
    this.getPrefBranch().setCharPref("gm-notifier.users.default", aUsername);
  }

  this.pushStateChange(aUsername, aStatus);
}

nsNotifierService.prototype.accountCheckStart = function(aUsername) {
  // only log 2 sessions.  Helps reduce memory usage.
  if (this.connectionCounter >= 2) {
    this.logString = "";
    this.connectionCounter = 0;
  }

  // http observer - init
  if (this.supportsMultiMode()) {
    this.observerService.addObserver(this, "http-on-modify-request", false);
    this.observerService.addObserver(this, "http-on-examine-response", false);
  }

  this.startConnection(aUsername);
}

nsNotifierService.prototype.accountCheckComplete = function() {
  // http observer - cleanup
  if (this.supportsMultiMode()) {
    this.observerService.removeObserver(this, "http-on-modify-request");
    this.observerService.removeObserver(this, "http-on-examine-response");
  }

  this.channel = null;

  this.currentUserQueue++;

  if (this.currentUserQueue < this.userQueue.length) {
    this.accountCheckStart(this.userQueue[this.currentUserQueue]);
  } else {
    // no longer auto connecting
    this.isAutoConnecting = false;
    this.currentUserQueue = null;

    // increment the connection counter
    this.connectionCounter++;

    this.pushStateChange(null, nsINotifierProgressListener.ACCOUNTS_CHECK_COMPLETED);

    this.setTimeout(this.getPrefBranch().getIntPref("gm-notifier.update.interval"));
  }
}

/**
 * startConnection and callback are the Gmail specific parts.
 */ 


var gConnectionPhases = {start: 1, gmail1phase1: 2, gmail2phase1: 3, finish: 4, finish2: 5};

nsNotifierService.prototype.startConnection = function (aUsername) {
  this.logItem("  StartConnection: Init");

  if (!aUsername) {
    return;
  }

  var start_time = (new Date()).getTime();
  this.logItem("  -- Username ("+aUsername+") found ");

  if (!this.userList[aUsername]) {
    this.logItem("  -- Uhoh, userlist didn't have user, create one");
    this.userList[aUsername] = this.newUserListItem(aUsername, null);
  }

  this.userList[aUsername].resetState = false;
  this.reusingCookie = false;
  this.connectionPhase = gConnectionPhases.start;

  this.pushStateChange(aUsername, nsINotifierProgressListener.LOGIN_INITIATED);

  var urlprotocol = "https://";//this.getURLProtocol();
  var hasHostedDomain = this.isHostedDomain(aUsername);

  // if we have stored cookie data, go directly to last phase
  if (this.userList[aUsername].cookieObject.GX) {
    this.reusingCookie = true;
    this.logItem("  -- attempting quick connect");

    if (this.userList[aUsername].isGmail20) {
      this.connectionPhase = gConnectionPhases.finish2;
      var url = urlprotocol + "mail.google.com/mail/?ik="+this.userList[aUsername].idkey+"&view=tl&start=0&num=25&rt=h&q=is%3Aunread&search=query";

      this.talkToServer(aUsername, url,
                        null, null, urlprotocol + "mail.google.com/",
                        this.hitch(this, this.callback));
    } else {
      this.connectionPhase = gConnectionPhases.finish;
      this.talkToServer(aUsername, urlprotocol+ "mail.google.com/mail/?search=query&q=is%3Aunread&view=tl&start=0&init=1&ui=1",
                        null, null, urlprotocol + "mail.google.com/",
                        this.hitch(this, this.callback));
    }
  } else if (hasHostedDomain && (this.userList[aUsername].cookieObject.GXAS || this.userList[aUsername].cookieObject.GXAS_SEC)) {
    this.reusingCookie = true;
    this.logItem("  -- attempting hosted quick connect");

    var hosteddomain = this.userList[aUsername].hosteddomain;

    if (this.userList[aUsername].isGmail20) {
      this.connectionPhase = gConnectionPhases.finish2;
      // XXX: here also had to hardcode http
      this.talkToServer(aUsername, "http://mail.google.com/a/"+hosteddomain+"/?ik="+this.userList[aUsername].idkey+"&view=tl&start=0&num=25&rt=h&q=is%3Aunread&search=query",
                        null, null, urlprotocol + "mail.google.com/a/"+hosteddomain,
                        this.hitch(this, this.callback));
    } else {
      this.connectionPhase = gConnectionPhases.finish;
      this.talkToServer(aUsername, urlprotocol+ "mail.google.com/a/"+hosteddomain+"/?search=query&q=is%3Aunread&view=tl&start=0&init=1&ui=1",
                        null, null, urlprotocol + "mail.google.com/a/"+hosteddomain,
                        this.hitch(this, this.callback));
    }
  } else {
    // set GMAIL_LOGIN
    /*var now = (new Date()).getTime();
    var cookie = "T" + start_time + "/" + start_time + "/" + now;
    var d = new Date();
    var expr = new Date(d.getFullYear()+1);
    this.userList[aUsername].cookieObject.GMAIL_LOGIN = "GMAIL_LOGIN="+cookie;*/

    if (hasHostedDomain) {
      this.exploritorySurgeryHosted(aUsername);
    } else {
      this.exploritorySurgery(aUsername);
    }
  }
}

nsNotifierService.prototype.exploritorySurgery = function(aUsername) {
  // load in the main gmail page and see what it tells us
  this.logItem("    exploritorySurgery for "+aUsername);

  this.talkToServer(aUsername, "https://www.google.com/accounts/ServiceLogin?service=mail", "", null, "https://www.google.com", this.hitch(this, this.exploritorySurgeryCallback));
}

nsNotifierService.prototype.exploritorySurgeryHosted = function(aUsername) {
  // load in the main gmail page and see what it tells us
  this.logItem("    exploritorySurgery for hosted account: "+aUsername);

  var index = aUsername.indexOf("@");
  var realusername =  aUsername.substring(0, index);
  var hosteddomain = aUsername.substring(index + 1, aUsername.length);
  this.userList[aUsername].hosteddomain = hosteddomain;
  this.logItem("  -- hosted domain found: " + hosteddomain);

  this.talkToServer(aUsername, "https://www.google.com/a/"+this.getHostedDomain(aUsername)+"/ServiceLogin?service=mail", "", null, "https://www.google.com", this.hitch(this, this.exploritorySurgeryHostedCallback));
}

nsNotifierService.prototype.exploritorySurgeryCallback = function(aData, aRequest, aUsername) {
  var val = aData.indexOf('<input type="hidden" name="service"');

  if (val >= 0) {
		var data = {}

		var forms = aData.match(/id="gaia_loginform"((.|[\n\r\s])*?)<\/form>/i);
		if (forms) {
		  var inputs = forms[1].match(new RegExp('<input(.*)[^>]*>', "gi"));
		
		  for (var i = 0; i < inputs.length; i++) {
		    var name = inputs[i].match(new RegExp('name="([^".]*)"', "i"));
		    var value = inputs[i].match(new RegExp('value="(.*)"', "i"));

		    if (name && value) {
		      data[name[1]] = value[1];
		    }
		  }
		}

		this.phaseStart(aUsername, data);
  } else {
    // go to phase 1
    this.phaseStart(aUsername);
  }
}

nsNotifierService.prototype.exploritorySurgeryHostedCallback = function(aData, aRequest, aUsername) {
  var val = aData.indexOf('<input type="hidden" name="service"');

  if (val >= 0) {
		var data = {}

		var forms = aData.match(/id="gaia_loginform"((.|[\n\r\s])*?)<\/form>/i);
		if (forms) {
		  var inputs = forms[1].match(new RegExp('<input(.*)[^>]*>', "gi"));

		  for (var i = 0; i < inputs.length; i++) {
		    var name = inputs[i].match(new RegExp('name="([^".]*)"', "i"));
		    var value = inputs[i].match(new RegExp('value="(.*)"', "i"));

		    if (name && value) {
		      data[name[1]] = value[1];
		    }
		  }
		}

		this.phaseStartHosted(aUsername, data);
  } else {
    // go to phase 1
    this.phaseStartHosted(aUsername);
  }
}

nsNotifierService.prototype.phaseStart = function(aUsername, aInputs) {
  var data = "";

  if (aInputs) {
    aInputs["Email"] = aUsername;
    aInputs["Passwd"] = this.getPassword(aUsername);
    aInputs["continue"] = "http://mail.google.com/mail/?ui=1&amp;zy=l"

    var c = 0;
    for (var label in aInputs) {
      data += (c == 0 ? "?": "&")+label + "=" + encodeURIComponent(aInputs[label]);
      c++;
    }
  } else {
    data = "?service=mail&Email=" + encodeURIComponent(aUsername)
             + "&Passwd=" + encodeURIComponent(this.getPassword(aUsername)) +
             "&rm=false&null=Sign%20in&continue=https://mail.google.com/mail?nsr=1&amp;ui=html&amp;zy=l";
  }

  this.talkToServer(aUsername, "https://www.google.com/accounts/ServiceLoginAuth?service=mail", data,
                    null, "https://www.google.com/accounts/ServiceLoginAuth", this.hitch(this, this.callback));
}

nsNotifierService.prototype.phaseStartHosted = function(aUsername, aInputs) {
  var data = "";

  var index = aUsername.indexOf("@");
  var realusername =  aUsername.substring(0, index);
  var hosteddomain = aUsername.substring(index + 1, aUsername.length);

  if (aInputs) {
    aInputs["Email"] = realusername;
    aInputs["Passwd"] = (this.getPassword(aUsername));
    aInputs["continue"] = "https://mail.google.com/a/"+hosteddomain+"/";

    var c = 0;
    for (var label in aInputs) {
      data += (c == 0 ? "?": "&")+label + "=" + encodeURIComponent(aInputs[label]);
      c++;
    }
  } else {
    data = "at=null&continue="+encodeURIComponent("https://mail.google.com/a/"+hosteddomain+"/")+"&service=mail&Email=" + escape(realusername)
           + "&Passwd=" + encodeURIComponent(this.getPassword(aUsername));
  }

  this.talkToServer(aUsername, "https://www.google.com/a/"+hosteddomain+"/LoginAction2?service=mail", data,
                    null, "https://www.google.com/accounts/ServiceLoginAuth", this.hitch(this, this.callback));
}

/*
   Phase              Description
   0                  Before anything has happend
   1                  First connection
   ...
*/

nsNotifierService.prototype.callback = function(aData, aRequest, aUsername) {
  this.logItem("    callback called for ("+aUsername+"), phase" + this.connectionPhase);

  this.logItem("    -- data ("+this.connectionPhase+")");

  //dump("\n\n\n----------\n"+aData+"\n----------\n\n\n");
  this.processConnectionPhase(aData, aRequest, aUsername);
}

nsNotifierService.prototype.processConnectionPhase = function(aData, aRequest, aUsername) {
  var urlprotocol = this.getURLProtocol();

  switch (this.connectionPhase) {
    case gConnectionPhases.start:
      var cookieData;

      // if no cookies sent, an exception is thrown
      /* try{
          var httpChannel = aRequest.QueryInterface(Components.interfaces.nsIHttpChannel)
          cookieData = httpChannel.getRequestHeader("cookie");
        } catch(e){} */
      var val = aData.indexOf("location.replace");
      var gmail20 = false;

      // gmail 2.0 ?
      if (val < 0) {
        // 2.0 has a meta redirect
        // XXX: what about hosted!!!
        val = aData.indexOf("URL=http://mail.google.com/mail");

        if (val < 0) {
          // old gmail 2.0
          val = aData.indexOf("MainPage.CheckLoaded();");
        }

        // newer way ?
        if (val < 0) {
          val = aData.indexOf("function onLoadTimeout()");
        }

        if (val > 0) {
          gmail20 = true;
          this.userList[aUsername].isGmail20 = true;
          this.logItem(" -- gmail 2.0 detected");
        }

        if (val < 0 && this.isHostedDomain(aUsername)) {
          // hosted gmail 2.0?
          val = aData.indexOf("ID_KEY:");

          if (val > 0) {
            this.logItem(" -- hosted gmail 2.0 detected");
            this.userList[aUsername].isGmail20 = true;
            gmail20 = true;
          } else {
            // last ditch attempts
            // look for <link rel="alternate" type="application/atom+xml"
            val = aData.indexOf('<link rel="alternate" type="application/atom+xml"');
            if (val > 0) {
              this.logItem(" -- hosted gmail 2.0 detected");
              this.userList[aUsername].isGmail20 = true;
              gmail20 = true;
            }
          }
        }

        if (val < 0) {
          this.userList[aUsername].isGmail20 = false;
        }
      }

      if (val < 0) {
        // XXX - check if its an image request

        // check if it is a password re-request
        if (aData.indexOf("<form action=\"LoginAuth\"") >= 0 || 
            aData.indexOf("errormsg_0_Passwd") >= 0) {
          this.logItem(encodeURIComponent(aData));
          this.accountCheckResult(aUsername, nsINotifierProgressListener.LOGIN_DETAILS_INVALID);
        } else {
          this.accountCheckResult(aUsername, nsINotifierProgressListener.LOGIN_FAILED);
        }

        this.accountCheckComplete();
        return;
      }

      var url = urlprotocol;
      if (this.userList[aUsername].hosteddomain) {
        url += "mail.google.com/hosted/" + this.userList[aUsername].hosteddomain;
      } else {
        url += "mail.google.com/mail";
      }

      if (gmail20) {
        if (this.isHostedDomain(aUsername)) {
          // we can skip to the next phase here, as ID key is present already
          // for hosted gmail 2.0 accounts
          this.connectionPhase = gConnectionPhases.gmail2phase1;
          this.processConnectionPhase(aData, aRequest, aUsername);
        } else {
          var regurl = new RegExp('URL=([^"]*)"').exec(aData);

          if (regurl && regurl[1]) {
            url = regurl[1];
          } else {
          }

          // XXX: hack - need to only load cookies for the domain!
          delete this.userList[aUsername].cookieObject.GAUSR;

          this.connectionPhase = gConnectionPhases.gmail2phase1;
          this.talkToServer(aUsername, url, null, null, url+"/",
                            this.hitch(this, this.callback));
        }
      } else {
        //var match = aData.match(/location.replace\((.*)\)/gm);
        //url = match[0].substr(18, match[0].length-2-18);
        this.connectionPhase = gConnectionPhases.gmail1phase1;
        this.talkToServer(aUsername, url + "?ui", null, null, url+"/",
                          this.hitch(this, this.callback));
      }
      break;

    case gConnectionPhases.gmail1phase1:
      var url = urlprotocol;
      if (this.userList[aUsername].hosteddomain) {
        url += "mail.google.com/hosted/" + this.userList[aUsername].hosteddomain;
      } else {
        url += "mail.google.com/mail";
      }

      this.connectionPhase = gConnectionPhases.finish;
      this.logItem("final url: "+url);
      this.talkToServer(aUsername,
                        url + "/?search=query&q=is%3Aunread&view=tl&start=0&init=1&ui=1",
                        null, null, url, this.hitch(this, this.callback));
      break;

    case gConnectionPhases.gmail2phase1:
      this.logItem("  looking for idkey");

      // figure out the id key
      var result = new RegExp("ID_KEY = \'([a-zA-Z0-9]*)\'").exec(aData);

      if (!result) {
        // can also be: ID_KEY:'...'
        result = new RegExp("ID_KEY:\'([a-zA-Z0-9]*)\'").exec(aData);
      }

      if (!result) {
        // can also be: ID_KEY:"..."
        result = new RegExp("ID_KEY:\"([a-zA-Z0-9]*)\"").exec(aData);
        var newHostedType = true;
      }

      var url = urlprotocol;
      if (this.userList[aUsername].hosteddomain) {
        if (!newHostedType) {
          // XXX: blah, need to hard code http here for some reason - but not for
          //"new" hosted accounts
          url = "http://mail.google.com/a/" + this.userList[aUsername].hosteddomain+"/";
        } else {
          url += "mail.google.com/a/" + this.userList[aUsername].hosteddomain+"/";
        }
      } else {
        url += "mail.google.com/mail";
      }

      // failed to login
      if (!result) {
        if (this.reusingCookie) {
          this.logItem("    - Login failed, but were reusing cookie data, so trying afresh.");

          // if we failed but were reusing the cookie, clear it and restart
          this.clearCookieObject(aUsername);
          this.reusingCookie = false;

          this.startConnection(aUsername);
          break;
        } else {
          // if non en-US, we need to switch to gmail 1.0
          if (aData.indexOf('(js.location.replace("?ui=1' > 0)) {
              this.userList[aUsername].isGmail20 = false;
              this.logItem("  - Not Gmail 2.0 after all - probably non-US locale.");

              this.connectionPhase = gConnectionPhases.finish;
              this.talkToServer(aUsername,
                        url + "/?search=query&q=is%3Aunread&view=tl&start=0&init=1&ui=1",
                        null, null, url, this.hitch(this, this.callback));
              break;
          } else {
            this.logItem("    - Login failed, page not the correct one.");

            this.accountCheckResult(aUsername, nsINotifierProgressListener.LOGIN_FAILED);
            this.accountCheckComplete();
            break;
          }
        }
      }
      var idkey = result[1];

      this.userList[aUsername].idkey = idkey;

      url += "?ik="+idkey+"&view=tl&start=0&num=25&rt=h&q=is%3Aunread&search=query";
      this.connectionPhase = gConnectionPhases.finish2;

      this.talkToServer(aUsername, url, null, null, url+"/", this.hitch(this, this.callback));

      break;

    case gConnectionPhases.finish2:
      // gmail 2.0 finish
      this.logItem("  connecting to gmail 2.0 complete.");

      // check if right page - has to have a ti
      if (!aData.match(/\["ti",.*\n.*\]/gm)) {
        // failed to login
        if (this.reusingCookie) {
          this.logItem("    - Login failed, but were reusing cookie data, so trying afresh.");

          // if we failed but were reusing the cookie, clear it and restart
          this.clearCookieObject(aUsername);
          this.reusingCookie = false;

          this.startConnection(aUsername);
        } else {
          this.logItem("    - Login failed, final page not the correct one.");
          //this.logItem(aData);

          this.accountCheckResult(aUsername, nsINotifierProgressListener.LOGIN_FAILED);
          this.accountCheckComplete();
        }

        return;
      }

      // account check was successfull
      this.accountCheckSuccess(aUsername);

      var obj = {totalunread: 0, inboxunread: 0, labels: [], quota: {}};

      // handle the total unread
      //   example: D(["ti","Search results for: is:unread",900,1,3000,"is:unread",_A(),"621a",700]);
      var ti = aData.match(/\["ti",.*\n.*\]/gm);
      this.logItem("  -  ti is " + ti);

      var arr = ti[0].split(",");
      obj.totalunread = parseInt(arr[2], 10);
      this.logItem("  -  total unread count is " + obj.totalunread);

      // now handle inbox and labels, which are stored in ld
      var ld = aData.match(/\["ld",.*\n(.*]\n)+\]/gm);
      this.logItem("  -  ld is " + ld.length);

      // setup a sandbox for eval usage
      var s = Components.utils.Sandbox("about:blank");

      // ld has three parts = "ld", general data (inbox, span, etc) and finally labels
      var data = Components.utils.evalInSandbox(ld[0], s);
      // need the ^i entry, which is the first, and the unread count is in the 2nd position
      obj.inboxunread = data[1][0][1];

      // now handle labels
      var labels = data[2];

      // utf-8 fun
      var conv = Components.classes["@mozilla.org/intl/utf8converterservice;1"].getService(Components.interfaces.nsIUTF8ConverterService);

      for (var i = 0; i < labels.length; i++) {
        var name = escape(conv.convertStringToUTF8(labels[i][0], "utf-8", false));
        var unread = labels[i][1];
        obj.labels.push({name: name, unread: unread});
      }

      // now handle quota
      var qu = aData.match(/\["qu",.*\]/);
      myArray = Components.utils.evalInSandbox(qu[0], s);

      obj.quota.spaceused = myArray[1];
      obj.quota.totalmb = myArray[2];
      obj.quota.spaceusedpercent = myArray[3];

      this.updateUserList(aUsername, obj);
      this.accountCheckComplete();
      break;


    case gConnectionPhases.finish:
      this.logItem("  connecting to gmail complete.");

      // Gmail now serves 2 versions of the ds string:
      // D(["ds",46,0,0,0,0,1298,0] or
      // D(["ds",[["inbox",3]\n,["drafts",2]\n,["spam",1053]\n]\n]n);

      var val;
      var newDS = false;

      if (aData.match(/\["ds",\[\[/)) {
        // new way
         this.logItem("    -- new ds");
        val = aData.match(/\["ds",.*\n(.*]\n)+\]/gm);

        newDS = true;
      } else {
        val = aData.match(/\["ds",.*\]/);
        this.logItem("    -- old ds");
      }

      if (!val) {
        // failed to login
        if (this.reusingCookie) {
          this.logItem("    - Login failed, but were reusing cookie data, so trying afresh.");

          // if we failed but were reusing the cookie, clear it and restart
          this.clearCookieObject(aUsername);
          this.reusingCookie = false;

          this.startConnection(aUsername);
        } else {
          this.logItem("    - Login failed, final page not the correct one.");
          //this.logItem(aData);

          this.accountCheckResult(aUsername, nsINotifierProgressListener.LOGIN_FAILED);
          this.accountCheckComplete();
        }

        return;
      }

      if (!this.multiuser) {
        // if we are in single user mode, set the user to be the default
        var defaultUser = this.getPrefBranch().getCharPref("gm-notifier.users.default");

        if (defaultUser != aUsername) {
          this.getPrefBranch().setCharPref("gm-notifier.users.default", aUsername);
        }
      }

      // if we aren't logged in, we are now and tell the world
      if (!this.loggedIn) {
        // update the pref
        this.getPrefBranch().setBoolPref("gm-notifier.loggedin", true);

        this.loggedIn = true;
        this.pushStateChange(null, nsINotifierProgressListener.NOTIFIER_LOGGED_IN);
      }

      // success!
      this.accountCheckResult(aUsername, nsINotifierProgressListener.LOGIN_SUCCESS);

      // get the unread count
      var ts = aData.match(/\["ts",.*\]/gm);
      var myArray = (JSON.fromString(ts[0]));
      this.logItem("  -  ts is " + ts);

      var totalUnread = myArray[3];

      // handle inbox
      myArray = JSON.fromString(val[0]);
      this.logItem("  -  val[0] " +  val[0]);

      var inboxUnread = 0;
      if (newDS) {
        inboxUnread = myArray[1][0][1];
      } else {
        inboxUnread = myArray[1];
      }

      this.logItem("  -  inboxUnread " +  inboxUnread + " and  this.userList[aUsername].inboxUnread is " +  this.userList[aUsername].inboxUnread);

      this.userList[aUsername].inboxNew = inboxUnread -  this.userList[aUsername].inboxUnread;
      this.userList[aUsername].inboxUnread = inboxUnread;

      // clear the array
      this.userList[aUsername].folders = new Array();
      this.userList[aUsername].folders.push(this.createFolder("inbox", inboxUnread));

      // XXX: do we really need this?
      if (this.userList[aUsername].inboxNew < 0) {
        this.userList[aUsername].inboxNew = 0;
      }

      // utf-8 fun
      var conv = Components.classes["@mozilla.org/intl/utf8converterservice;1"].getService(Components.interfaces.nsIUTF8ConverterService);

      // handle labels
      var labelsVal = aData.match(/\["ct",.*\n(.*]\n)+\]/gm);
      if (labelsVal) {
        var labelsArray = JSON.fromString(labelsVal[0])[1];

        for (var run = 0; run < labelsArray.length; run++) {
          var folderName = escape(conv.convertStringToUTF8(labelsArray[run][0], "utf-8", false));

          // gmail skins extension workaround
          var skip = (folderName.indexOf("gmskin%3A") == 0);

          if (!skip) {
           this.userList[aUsername].folders.push(this.createFolder(folderName, labelsArray[run][1]));
           this.logItem("  - Folder found (name: " + folderName + " and unread emails: " + labelsArray[run][1] + ")");
          }
        }
      }

      // new/unread mail check
      this.logItem("  -inboxUnread: " + inboxUnread + ", unreadEmails: " + this.userList[aUsername].unreadEmails + ", inboxNew: "+this.userList[aUsername].inboxNew+", totalunread: " + totalUnread);

      var showInboxOnly = this.getPrefBranch().getBoolPref("gm-notifier.ui.counter.showInbox");
      var hasNewMail = (totalUnread > this.userList[aUsername].unreadEmails);

      if (!hasNewMail && showInboxOnly) {
        hasNewMail = (this.userList[aUsername].inboxNew > 0);
      }

      if ((this.userList[aUsername].unreadEmails != null) && hasNewMail) {
        this.logItem("  New Unread Mail Found!");
        // new email
        this.userList[aUsername].newEmails = totalUnread - this.userList[aUsername].unreadEmails;
        this.userList[aUsername].unreadEmails = totalUnread;

        if (showInboxOnly && (this.userList[aUsername].inboxNew == 0)) {
          // show inbox only, but new mail wasn't in inbox
          this.pushStateChange(aUsername, nsINotifierProgressListener.NO_NEW_MAIL);
          //this.setNewMailMode(aUsername, false);
        } else {
          this.pushStateChange(aUsername, nsINotifierProgressListener.NEW_MAIL);
          this.setNewMailMode(aUsername, true);
          var count = this.getNewCount(aUsername);
          this.newMailNotification(aUsername, count);
          this.newMailCount = count;
        }
      } else if (this.userList[aUsername].unreadEmails == null && totalUnread > 0) {
        // first time
        this.logItem("  New Mail Found!");
        this.userList[aUsername].newEmails = totalUnread;
        this.userList[aUsername].unreadEmails = totalUnread;

        if (showInboxOnly && (this.userList[aUsername].inboxNew == 0)) {
          // show inbox only, but new mail wasn't in inbox
          this.pushStateChange(aUsername, nsINotifierProgressListener.NO_NEW_MAIL);
        } else {
          this.pushStateChange(aUsername, nsINotifierProgressListener.NEW_MAIL);
          this.setNewMailMode(aUsername, true);
          this.logItem("  - amount of new mail is " + this.userList[aUsername].newEmails);
          var count = this.getDisplayCount(aUsername);
          this.logItem("  - mail notification about to be set, new mail count is " + count);
          this.newMailNotification(aUsername, count);
          this.newMailCount = count;
        }
      } else {
        // check if the count decreased
        var decreased = false;

        if (totalUnread < this.userList[aUsername].unreadEmails) {
          decreased = true;
        }

        this.userList[aUsername].unreadEmails = totalUnread;
        this.logItem("  No New Unread Mail Found!");
        this.pushStateChange(aUsername, nsINotifierProgressListener.NO_NEW_MAIL);

        // only set mode to false if the count decreased. So if the user hasn't
        // checked the mail and we had new mail before, we stay in the new mail
        // mode.
        if (decreased) {
          this.userList[aUsername].newEmails = 0;
          this.setNewMailMode(aUsername, false);
        } else if (this.getNewMailMode(aUsername) &&
                   this.getPrefBranch().getBoolPref("gm-notifier.notification.repeat")) {
          this.logItem("  - mail notification about to be set again, new mail count is " + this.newMailCount);
          this.newMailNotification(aUsername, this.newMailCount);
        } else {
          this.userList[aUsername].newEmails = 0;
        }
      }

      val = aData.match(/\["qu",.*\]/);
      myArray = JSON.fromString(val[0]);

      var spaceused, totalmb, spaceusedpercent;
      spaceused = myArray[1];
      totalmb = myArray[2];
      spaceusedpercent = myArray[3];

      // if we have %, parseInt time.  This happens for localized gmail right
      // now
      if (spaceusedpercent.indexOf("%") != -1) {
        function _parseInt(aString) {
          var parsed = parseInt(aString, 10);
          if (parsed != NaN) {
            return parsed;
          }

          return aString;
        }

        spaceused = _parseInt(spaceused);
        totalmb = _parseInt(totalmb);
        spaceusedpercent = _parseInt(spaceusedpercent);
      }

      this.userList[aUsername].space_used_mb = spaceused;
      this.userList[aUsername].total_mb =totalmb;
      this.userList[aUsername].space_used_percent = spaceusedpercent;

      this.accountCheckComplete();
      //this.setTimer();
      break;
  }
}

nsNotifierService.prototype.updateUserList = function(aUsername, aData) {
  var user = this.userList[aUsername];
  var totalUnread = aData.totalunread;

  this.logItem("  -  inboxUnread " +  aData.inboxunread + " and  this.userList[aUsername].inboxUnread is " +  user.inboxUnread);

  user.inboxNew = aData.inboxunread -  user.inboxUnread;
  user.inboxUnread = aData.inboxunread;

  // XXX: do we really need this?
  if (user.inboxNew < 0) {
    user.inboxNew = 0;
  }

  // folders

  // clear the array
  user.folders = new Array();
  user.folders.push(this.createFolder("inbox", aData.inboxunread));

  for (var i = 0; i < aData.labels.length; i++) {
    // gmail skins extension workaround
    var skip = (aData.labels[i].name.indexOf("gmskin%3A") == 0);

    if (!skip) {
     user.folders.push(this.createFolder(aData.labels[i].name, aData.labels[i].unread));
     this.logItem("  - Folder found (name: " + aData.labels[i].name + " and unread emails: " + aData.labels[i].unread + ")");
    }
  }

  // quota
  user.space_used_mb = aData.quota.spaceused;
  user.total_mb = aData.quota.totalmb;
  user.space_used_percent = aData.quota.spaceusedpercent;

  // new/unread mail check
  this.logItem("  -inboxUnread: " +  aData.inboxunread + ", unreadEmails: " + user.unreadEmails + ", inboxNew: "+user.inboxNew+", totalunread: " + totalUnread);

  var showInboxOnly = this.getPrefBranch().getBoolPref("gm-notifier.ui.counter.showInbox");
  var hasNewMail = (totalUnread > user.unreadEmails);

  if (!hasNewMail && showInboxOnly) {
    hasNewMail = (user.inboxNew > 0);
  }

  if ((user.unreadEmails != null) && hasNewMail) {
    this.logItem("  New Unread Mail Found!");
    // new email
    user.newEmails = totalUnread - user.unreadEmails;
    user.unreadEmails = totalUnread;

    if (showInboxOnly && (user.inboxNew == 0)) {
      // show inbox only, but new mail wasn't in inbox
      this.pushStateChange(aUsername, nsINotifierProgressListener.NO_NEW_MAIL);
      //this.setNewMailMode(aUsername, false);
    } else {
      this.pushStateChange(aUsername, nsINotifierProgressListener.NEW_MAIL);
      this.setNewMailMode(aUsername, true);
      var count = this.getNewCount(aUsername);
      this.newMailNotification(aUsername, count);
      this.newMailCount = count;
    }
  } else if (user.unreadEmails == null && totalUnread > 0) {
    // first time
    this.logItem("  New Mail Found!");
    user.newEmails = totalUnread;
    user.unreadEmails = totalUnread;

    if (showInboxOnly && (user.inboxNew == 0)) {
      // show inbox only, but new mail wasn't in inbox
      this.pushStateChange(aUsername, nsINotifierProgressListener.NO_NEW_MAIL);
    } else {
      this.pushStateChange(aUsername, nsINotifierProgressListener.NEW_MAIL);
      this.setNewMailMode(aUsername, true);
      this.logItem("  - amount of new mail is " + user.newEmails);
      var count = this.getDisplayCount(aUsername);
      this.logItem("  - mail notification about to be set, new mail count is " + count);
      this.newMailNotification(aUsername, count);
      this.newMailCount = count;
    }
  } else {
    // check if the count decreased
    var decreased = false;

    if (totalUnread < user.unreadEmails) {
      decreased = true;
    }

    user.unreadEmails = totalUnread;
    this.logItem("  No New Unread Mail Found!");
    this.pushStateChange(aUsername, nsINotifierProgressListener.NO_NEW_MAIL);

    // only set mode to false if the count decreased. So if the user hasn't
    // checked the mail and we had new mail before, we stay in the new mail
    // mode.
    if (decreased) {
      user.newEmails = 0;
      this.setNewMailMode(aUsername, false);
    } else if (this.getNewMailMode(aUsername) &&
               this.getPrefBranch().getBoolPref("gm-notifier.notification.repeat")) {
      this.logItem("  - mail notification about to be set again, new mail count is " + this.newMailCount);
      this.newMailNotification(aUsername, this.newMailCount);
    } else {
      user.newEmails = 0;
    }
  }
}

nsNotifierService.prototype.accountCheckSuccess = function(aUsername) {
  if (!this.multiuser) {
    // if we are in single user mode, set the user to be the default
    var defaultUser = this.getPrefBranch().getCharPref("gm-notifier.users.default");

    if (defaultUser != aUsername) {
      this.getPrefBranch().setCharPref("gm-notifier.users.default", aUsername);
    }
  }

  // if we aren't logged in, we are now and tell the world
  if (!this.loggedIn) {
    // update the pref
    this.getPrefBranch().setBoolPref("gm-notifier.loggedin", true);

    this.loggedIn = true;
    this.pushStateChange(null, nsINotifierProgressListener.NOTIFIER_LOGGED_IN);
  }

  // success!
  this.accountCheckResult(aUsername, nsINotifierProgressListener.LOGIN_SUCCESS);
}

nsNotifierService.prototype.buildCookieString = function(aCookieObject, aURI) {
  var cookiestring = "";

  for (var cookie in aCookieObject) {
    if (aCookieObject[cookie]) {
      // make sure the cookie fits the domain
      //this.logItem("c: "+cookie + " " + aURI.host + " - " + aCookieObject[cookie].domain);
      if (aURI.host == aCookieObject[cookie].domain || aURI.host.indexOf(aCookieObject[cookie].domain) >= 0) {
        if (aCookieObject[cookie].value) {
          cookiestring += aCookieObject[cookie].value + "; ";
        }
      }
    }
  }

  //this.logItem("c2: "+cookiestring);

  /*if (aCookieObject.GX) {
    cookie += aCookieObject.GX + " ";
  }

  if (aCookieObject.SID) {
    cookie += aCookieObject.SID + " ";
  }

  if (aCookieObject.LSID) {
    cookie += aCookieObject.LSID + " ";
  }

  if (aCookieObject.HID) {
    cookie += aCookieObject.HID + " ";
  }

  if (aCookieObject.GXAS) {
    cookie += aCookieObject.GXAS + " ";
  }

  if (aCookieObject.GXAS_SEC) {
    cookie += aCookieObject.GXAS_SEC + " ";
  }

  if (aCookieObject.S) {
    cookie += aCookieObject.S + " ";
  }*/
  return cookiestring;
}

nsNotifierService.prototype.clearCookieObject = function(aUsername) {
  for (var cookie in this.userList[aUsername].cookieObject) {
    delete this.userList[aUsername].cookieObject[cookie];
  }

  /*this.userList[aUsername].cookieObject.GX = "";
  this.userList[aUsername].cookieObject.SID = "";
  this.userList[aUsername].cookieObject.LSID = "";
  this.userList[aUsername].cookieObject.GXAS_SEC = "";
  this.userList[aUsername].cookieObject.GXAS = "";
  this.userList[aUsername].cookieObject.HID = "";
  this.userList[aUsername].cookieObject.S = "";*/
  delete this.userList[aUsername].rememberme;
  delete this.userList[aUsername].remembermeExpires;
}

nsNotifierService.prototype.loadCookieData = function(aUsername) {
  // We should follow the user's choice if to remember the login info beyond
  // the current session.
   this.logItem("  -- loading cookie data for " + aUsername);
  var rememberme = this.userList[aUsername].rememberme;
  var remembermeExpires = this.userList[aUsername].remembermeExpires;

  var isHostedDomain = this.isHostedDomain(aUsername);

  if (rememberme == undefined) {
    var cookieMgr = Components.classes[kCOOKIESERVICE_CONTRACTID]
                              .getService(Components.interfaces.nsICookieManager);

    var e = cookieMgr.enumerator;
    var cookie, done = false;
    while (!done && e.hasMoreElements()) {
      cookie = e.getNext().QueryInterface(Components.interfaces.nsICookie);

      if (cookie.host == ".google.com" || cookie.host == "google.com") {
        if (!isHostedDomain && cookie.name == "rememberme") {
          done = true;
          rememberme = (cookie.value == "true");
          if (rememberme) {
            remembermeExpires = cookie.expires;
          } else {
            remembermeExpires = null;
          }
          this.logItem("  -- 1 rememberme cookie value is " + cookie.value);
        } else if (!isHostedDomain && cookie.name == "LSID" &&
                   (rememberme == undefined)) {
          // no remember me, check expire date
          var expireDate = new Date(1000 * cookie.expires);
          var currentDate = new Date();

          this.logItem("  "+expireDate.getFullYear() + " vs "  + currentDate.getFullYear());

          if ((expireDate.getFullYear() - 2) > currentDate.getFullYear()) {
            // expires in more than 2 years
            rememberme = true;
            remembermeExpires = cookie.expires;

            this.logItem("  -- 2 rememberme cookie value is " + cookie.value);
          }
        } else if (isHostedDomain && cookie.name == "HID") {
          if (cookie.path != "/hosted/" + this.getHostedDomain(aUsername) + "/") {
            continue;
          }

          // we are done
          done = true;

          // no remember me, check expire date
          var expireDate = new Date(1000 * cookie.expires);
          var currentDate = new Date();

          this.logItem("  "+expireDate.getFullYear() + " vs "  + currentDate.getFullYear());

          if ((expireDate.getFullYear() - 2) > currentDate.getFullYear()) {
            // expires in more than 2 years
            rememberme = true;
            remembermeExpires = cookie.expires;

            this.logItem("  -- 3 rememberme cookie value is " + cookie.value);
          }
        }
      }
    }

    if (done) {
      // store the rememberme
      this.userList[aUsername].rememberme = rememberme;
      this.userList[aUsername].remembermeExpires = remembermeExpires;
    }
  }

  this.logItem("  remembermeExpires: "+this.userList[aUsername].remembermeExpires);

  var cookieService = Components.classes["@mozilla.org/cookieService;1"]
                                .getService(Components.interfaces.nsICookieService);
  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);

  function formatExpiresString(aExpires) {
    if (!aExpires) {
      return "0";
    }

    // stolen from the cookie prefs in Mozilla :)
    var sdf = Components.classes["@mozilla.org/intl/scriptabledateformat;1"]
                        .getService(Components.interfaces.nsIScriptableDateFormat);
    var date = new Date(1000 * aExpires);
    return sdf.FormatDateTime("", sdf.dateFormatLong,
                                  sdf.timeFormatSeconds,
                                  date.getFullYear(),
                                  date.getMonth() + 1,
                                  date.getDate(),
                                  date.getHours(),
                                  date.getMinutes(),
                                  date.getSeconds());
  }

  var expires = "";
  if (typeof(this.userList[aUsername].remembermeExpires) == "string") {
    expires = "Expires=" + formatExpiresString(this.userList[aUsername].remembermeExpires);
  }

  this.clearCookieData();

  // XXX: why not just load all cookies from the cookie object
  if (!isHostedDomain) {
    var gx = this.userList[aUsername].cookieObject.GX.value + ";";

    if (!!expires) {
      gx += expires+";";
    }
    gx += "Path=/mail";

    //this.loadCookieIntoApp(this.userList[aUsername].cookieObject.GX);
    //cookieService.setCookieString(ioService.newURI("http://mail.google.com", null, null), null, gx, null);

    //this.loadCookieIntoApp(this.userList[aUsername].cookieObject.SID);
    //cookieService.setCookieString(ioService.newURI("http://.google.com", null, null), null, this.userList[aUsername].cookieObject.SID.value + ";" + expires, null);

    //this.loadCookieIntoApp(this.userList[aUsername].cookieObject.GXSP);

    for (var x in this.userList[aUsername].cookieObject) {
      this.loadCookieIntoApp(this.userList[aUsername].cookieObject[x]);
    }
  } else {
    if (this.userList[aUsername].cookieObject.GXAS_SEC) {
      this.loadCookieIntoApp(this.userList[aUsername].cookieObject.GXAS_SEC);
      //cookieService.setCookieString(ioService.newURI("http://mail.google.com", null, null), null, this.userList[aUsername].cookieObject.GXAS_SEC.value + ";" + expires+";Path=/a", null);
    }

    this.loadCookieIntoApp(this.userList[aUsername].cookieObject.GXSP);

    if (this.userList[aUsername].cookieObject.GXAS) {
      this.loadCookieIntoApp(this.userList[aUsername].cookieObject.GXAS);
      //cookieService.setCookieString(ioService.newURI("http://mail.google.com", null, null), null, this.userList[aUsername].cookieObject.GXAS.value + ";" + expires+";Path=/a", null);
    }

    if (this.userList[aUsername].cookieObject.HID) {
      this.loadCookieIntoApp(this.userList[aUsername].cookieObject.HID);
      //cookieService.setCookieString(ioService.newURI("https://.www.google.com", null, null), null, this.userList[aUsername].cookieObject.HID.value + ";" + expires+";Path=/a/"+this.getHostedDomain(aUsername)+"/", null);
    }

    if (this.userList[aUsername].isGmail20) {
      this.loadCookieIntoApp(this.userList[aUsername].cookieObject.S);
      //cookieService.setCookieString(ioService.newURI("http://mail.google.com", null, null), null, this.userList[aUsername].cookieObject.S.value + ";" + expires+";Path=/a/"+this.getHostedDomain(aUsername), null);
    }
  }
}

nsNotifierService.prototype.clearCookieData = function() {
  this.logItem("  -- clearing cookie data!!");

  var cookieMgr = Components.classes[kCOOKIESERVICE_CONTRACTID]
                            .getService(Components.interfaces.nsICookieManager);

  var e = cookieMgr.enumerator;

  while (e.hasMoreElements()) {
    var cookie = e.getNext().QueryInterface(Components.interfaces.nsICookie);
          //this.logItem(cookie.host+ " , "+cookie.name+ " , " +cookie.path);

    if (cookie.host == "mail.google.com" || cookie.host == ".mail.google.com") {
      //this.logItem(cookie.host+ " , "+cookie.name+ " , " +cookie.path);

     cookieMgr.remove(cookie.host, cookie.name, cookie.path, false);
    }
  }

 // cookieMgr.remove("mail.google.com", "GX", "/mail", false);
  //cookieMgr.remove(".google.com", "SID", "/", false);
  //cookieMgr.remove("mail.google.com", "GXAS", "/hosted", false);
  //cookieMgr.remove("mail.google.com", "GXAS", "/a/", false);
  //cookieMgr.remove("mail.google.com", "GXSP", "", false);
  //cookieMgr.remove("mail.google.com", "GXAS_SEC", "/hosted", false);
  //cookieMgr.remove("mail.google.com", "S", "/mail", false);


  var defaultUser = this.getPrefBranch().getCharPref("gm-notifier.users.default");

  cookieMgr.remove(".google.com", "HID", "/hosted"+this.getHostedDomain(defaultUser)+"/", false);
}

nsNotifierService.prototype.isHostedDomain = function(aUsername) {
  var isHosted = false;

  if (aUsername.indexOf("@") > 0) {
    var domain = this.getHostedDomain(aUsername);

    // don't treat gmail.com/googlemail.com has hosted domains
    if (domain == "gmail.com" || domain == "googlemail.com") {
      isHosted = false;
    } else {
      isHosted = true;
    }
  }

  return isHosted;
}

nsNotifierService.prototype.getHostedDomain = function(aUsername) {
  var index = aUsername.indexOf("@");

  if (index >= 0) {
    return aUsername.substring(index+1, aUsername.length).toLowerCase();
  } else {
    return null;
  }
}

/* json code */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla code.
 *
 * The Initial Developer of the Original Code is
 * Simon Bünzli <zeniko@gmail.com>
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * Utilities for JavaScript code to handle JSON content.
 * See http://www.json.org/ for comprehensive information about JSON.
 *
 * Import this module through
 *
 * Components.utils.import("resource://gre/modules/JSON.jsm");
 *
 * Usage:
 *
 * var newJSONString = JSON.toString( GIVEN_JAVASCRIPT_OBJECT );
 * var newJavaScriptObject = JSON.fromString( GIVEN_JSON_STRING );
 *
 * Note: For your own safety, Objects/Arrays returned by
 *       JSON.fromString aren't instanceof Object/Array.
 */


var JSON = {
  /**
   * Converts a JavaScript object into a JSON string.
   *
   * @param aJSObject is the object to be converted
   * @param aKeysToDrop is an optional array of keys which will be
   *                    ignored in all objects during the serialization
   * @return the object's JSON representation
   *
   * Note: aJSObject MUST not contain cyclic references.
   */
  toString: function JSON_toString(aJSObject, aKeysToDrop) {
    // we use a single string builder for efficiency reasons
    var pieces = [];
    
    // this recursive function walks through all objects and appends their
    // JSON representation (in one or several pieces) to the string builder
    function append_piece(aObj) {
      if (typeof aObj == "string") {
        aObj = aObj.replace(/[\\"\x00-\x1F\u0080-\uFFFF]/g, function($0) {
          // use the special escape notation if one exists, otherwise
          // produce a general unicode escape sequence
          switch ($0) {
          case "\b": return "\\b";
          case "\t": return "\\t";
          case "\n": return "\\n";
          case "\f": return "\\f";
          case "\r": return "\\r";
          case '"':  return '\\"';
          case "\\": return "\\\\";
          }
          return "\\u" + ("0000" + $0.charCodeAt(0).toString(16)).slice(-4);
        });
        pieces.push('"' + aObj + '"')
      }
      else if (typeof aObj == "boolean") {
        pieces.push(aObj ? "true" : "false");
      }
      else if (typeof aObj == "number" && isFinite(aObj)) {
        // there is no representation for infinite numbers or for NaN!
        pieces.push(aObj.toString());
      }
      else if (aObj === null) {
        pieces.push("null");
      }
      // if it looks like an array, treat it as such - this is required
      // for all arrays from either outside this module or a sandbox
      else if (aObj instanceof Array ||
               typeof aObj == "object" && "length" in aObj &&
               (aObj.length === 0 || aObj[aObj.length - 1] !== undefined)) {
        pieces.push("[");
        for (var i = 0; i < aObj.length; i++) {
          arguments.callee(aObj[i]);
          pieces.push(",");
        }
        if (aObj.length > 0)
          pieces.pop(); // drop the trailing colon
        pieces.push("]");
      }
      else if (typeof aObj == "object") {
        pieces.push("{");
        for (var key in aObj) {
          // allow callers to pass objects containing private data which
          // they don't want the JSON string to contain (so they don't
          // have to manually pre-process the object)
          if (aKeysToDrop && aKeysToDrop.indexOf(key) != -1)
            continue;
          
          arguments.callee(key.toString());
          pieces.push(":");
          arguments.callee(aObj[key]);
          pieces.push(",");
        }
        if (pieces[pieces.length - 1] == ",")
          pieces.pop(); // drop the trailing colon
        pieces.push("}");
      }
      else {
        throw new TypeError("No JSON representation for this object!");
      }
    }
    append_piece(aJSObject);
    
    return pieces.join("");
  },

  /**
   * Converts a JSON string into a JavaScript object.
   *
   * @param aJSONString is the string to be converted
   * @return a JavaScript object for the given JSON representation
   */
  fromString: function JSON_fromString(aJSONString) {
    if (!this.isMostlyHarmless(aJSONString))
      throw new SyntaxError("No valid JSON string!");
    
    var s = new Components.utils.Sandbox("about:blank");
    return Components.utils.evalInSandbox("(" + aJSONString + ")", s);
  },

  /**
   * Checks whether the given string contains potentially harmful
   * content which might be executed during its evaluation
   * (no parser, thus not 100% safe! Best to use a Sandbox for evaluation)
   *
   * @param aString is the string to be tested
   * @return a boolean
   */
  isMostlyHarmless: function JSON_isMostlyHarmless(aString) {
    const maybeHarmful = /[^,:{}\[\]0-9.\-+Eaeflnr-u \n\r\t]/;
    const jsonStrings = /"(\\.|[^"\\\n\r])*"/g;
    
    return !maybeHarmful.test(aString.replace(jsonStrings, ""));
  }
};



// timing stuff
nsNotifierService.prototype.setTimer = function() {
  if (this.updateTimer) {
    this.updateTimer.cancel();
  } else {
    this.updateTimer = Components.classes[kTIMER_CONTRACTID].createInstance(nsITimer);
  }

  this.logItem("Starting at : " + new Date());
  try {
    this.updateTimer.initWithCallback(this, this.timeOut, nsITimer.TYPE_ONE_SHOT);
  } catch (e) {
    this.logItem(e);
  }
}

// nsITimer
nsNotifierService.prototype.notify = function(aTimer) {
  this.logItem("  *************** notify called");
  this.logItem("End: " + new Date());
  this.checkAccounts();
}

nsNotifierService.prototype.pushStateChange = function(aUsername, aState) {
  for (var run = 0; run < this.listeners.length; run++) {
    // can be null if a listener was removed
    if (this.listeners[run]) {
      this.listeners[run].onStateChange(aUsername, aState);
    }
  }
}

nsNotifierService.prototype.observer = function(aCallbackFunc, aUsername, aThis) {
  var myThis = aThis;

  return ({
    data : "",

    onStartRequest : function (aRequest, aContext) {
      this.data = "";
    },

    onDataAvailable : function (aRequest, aContext, aStream, aSourceOffset, aLength){
      var scriptableInputStream = 
        Components.classes["@mozilla.org/scriptableinputstream;1"]
                  .createInstance(Components.interfaces.nsIScriptableInputStream);
      scriptableInputStream.init(aStream);

      this.data += scriptableInputStream.read(aLength);
    },

    onStopRequest : function (aRequest, aContext, aStatus) {
      // XXX: proxy issue: aStatus is an error from http://lxr.mozilla.org/seamonkey/source/netwerk/base/public/nsNetError.h#172
      aCallbackFunc(this.data, aRequest, aUsername);
    },

    onChannelRedirect : function (aOldChannel, aNewChannel, aFlags) {
      //dump("\nredirect!");
      if (aOldChannel == myThis.channel)  {
        //myThis.logItem("   - redirect to: "+aNewChannel.URI.spec);
        myThis.channel = aNewChannel;
      }
    },

    // nsIInterfaceRequestor
    getInterface: function (aIID) {
      try {
        return this.QueryInterface(aIID);
      } catch (e) {
        throw Components.results.NS_NOINTERFACE;
      }
    },

    // nsIProgressEventSink (to shut up annoying debug exceptions
    onProgress : function (aRequest, aContext, aProgress, aProgressMax) { },
    onStatus : function (aRequest, aContext, aStatus, aStatusArg) { },

    // nsIHttpEventSink (to shut up annoying debug exceptions
    onRedirect : function (aOldChannel, aNewChannel) { },

    QueryInterface : function(aIID) {
      if (aIID.equals(nsISupports) ||
          aIID.equals(Components.interfaces.nsIDocShell) ||
          aIID.equals(Components.interfaces.nsIInterfaceRequestor) ||
          aIID.equals(Components.interfaces.nsIChannelEventSink) || 
          aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
          aIID.equals(Components.interfaces.nsIProgressEventSink) ||
          aIID.equals(Components.interfaces.nsIPrompt) ||
          aIID.equals(Components.interfaces.nsIHttpEventSink) ||
          aIID.equals(Components.interfaces.nsIDocShellTreeItem) ||
          aIID.equals(Components.interfaces.nsIStreamListener))
        return this;

      throw Components.results.NS_NOINTERFACE;
    }
  }
  );
}

/*
  New mail notification
 */
nsNotifierService.prototype.newMailNotification = function(aUsername, aNewNum) {
  if (aNewNum < 1) {
    return;
  }

  this.logItem("  New Mail Notification Init:");

  var isNotificationEnabled = this.getPrefBranch().getBoolPref("gm-notifier.ui.notification.enabled");
  this.logItem("    Is System Notification Enabled by user: " + isNotificationEnabled);

  if (isNotificationEnabled) {
    var msg = this.getFormattedString("NotificationMsg", [aNewNum]);
    var title = this.getFormattedString("NotificationMsgTitle", [aUsername]);

    try {
      if ("@mozilla.org/alerts-service;1" in Components.classes) {
        var alertService = Components.classes["@mozilla.org/alerts-service;1"]
                                     .getService(Components.interfaces.nsIAlertsService);
        if (alertService) {
          alertService.showAlertNotification("chrome://gm-notifier/content/gm-logo.png",
                                           title, msg, true, aUsername, this);
          this.logItem("    alertsService success.");
        } else {
          this.logItem("    alertsService failure: could not getService nsIAlertsService");
        }
      } else if ("@growl.info/notifications;1" in Components.classes) {
        // try growl
        var growl = Components.classes["@growl.info/notifications;1"].getService(Components.interfaces.grINotifications);

        if (growl) {
          this.logItem("    using growl service");
          growl.sendNotification(aUsername, "chrome://gm-notifier/content/gm-logo.png", title, msg, this);
        } else {
          this.logItem("    growl service failed");
        }
      }
    } catch(e) {
       this.logItem("    alertsService failure: " + e);
    }
  }

  // sound notifications
  var isSoundNotificationsEnabled = this.getPrefBranch().getBoolPref("gm-notifier.ui.soundnotification.enabled");
  this.logItem("  Is Sound Notification Enabled by user: " + isSoundNotificationsEnabled);

  if (isSoundNotificationsEnabled) {
    var soundUrl = this.getPrefBranch().getCharPref("gm-notifier.ui.soundnotification.uri");

    try {
      var sound = Components.classes["@mozilla.org/sound;1"]
                            .createInstance(Components.interfaces.nsISound);
      sound.init();

      var shortname = soundUrl.substr(0, 7);

      if (shortname == "http://" || shortname == "https:/") {
        var url = Components.classes["@mozilla.org/network/standard-url;1"]
                            .createInstance(Components.interfaces.nsIURL);
        url.spec = soundUrl;
        sound.play(url);
      } else {
        var localFile = Components.classes["@mozilla.org/file/local;1"]
                           .createInstance(Components.interfaces.nsILocalFile);
        localFile.initWithPath(soundUrl);

        var ios = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);
        sound.play(ios.newFileURI(localFile));
      }
    } catch (e) {
      this.logItem("  Sound playing failed with: "+ e);
    }
  }
}

// nsIObserver for alert service - aData will be the username
nsNotifierService.prototype.observe = function (aSubject, aTopic, aData){
  switch (aTopic) {
    case "alertfinished":
      break;

    case "alertclickcallback":
      this.showNotification(aData);
      break;

    case "http-on-modify-request":
      // happens right before we send out the request, so that we can overwrite
      // the cookie data with ours.  Make sure it is our connection first.
      if (aSubject == this.channel) {
        var httpChannel = aSubject.QueryInterface(nsIHttpChannel);

        // overwrite the cookie we are going to be sending with ours.
        var username = this.userQueue[this.currentUserQueue];
        // create cookie string
        var cookieobject = this.userList[username].cookieObject;
        var cookie = this.buildCookieString(cookieobject, httpChannel.URI);

        this.logItem("    -- cookie string is: " + cookie);

        httpChannel.setRequestHeader("Cookie", cookie, false);

        //dump("\n Request: "+ httpChannel.URI.spec+ "\n  Cookie: "+ cookie +"\n");
      }
      break;

    case "http-on-examine-response":
      // happens right before we process the response, so that we can store
      // and empty the Set-Cookie directive, so that the user's cookies aren't
      // overwritten by our connections.  Make sure it is our connection first.
      if (aSubject == this.channel) {
        var httpChannel = aSubject.QueryInterface(nsIHttpChannel);
        var cookie = "";

        try {
          cookie = httpChannel.getResponseHeader("Set-Cookie");
        } catch(e) {}

        //dump("\n Response: " + httpChannel.URI.spec+ "\n  Cookie: " + cookie +"\n");

        var username = this.userQueue[this.currentUserQueue];

        // parse the cookie.  Yes, we have a mini-parser here to make sure we get
        // all the cookies we need and dump the unused ones (including the
        // commands to expire certain cookies.

        this.logItem("    -- cookie response is: " + cookie);
        var split = cookie.split("\n");
        var newcookie = "";
        var usercookieobject = this.userList[username].cookieObject;
        var expired = false;

        function getCookieString(aString) {
          var end = aString.indexOf(";");
          return aString.substr(0, end);
        }

        function getCookieDomain(aString) {
          var domain = aString.match(/\Domain=([a-zA-Z0-9.]*);/);
          return domain ? domain[1] : httpChannel.URI.host;
        }

        function getCookiePath(aString) {
          var path = aString.match(/\Path=([a-zA-Z0-9.\/]*);/);
          return path ? path[1] : null;
        }

        for (var i = 0; i < split.length; i++) {
          if (split[i].indexOf("=EXPIRED") > 0) {
            expired = true;
          } else {
            expired = false;
          }

          var index = split[i].indexOf("=");
          var cookiename = split[i].substr(0, index);

          if (!cookiename) {
            continue;
          }

          if (expired) {
            //dump("\n -- killing "+cookiename);
            delete usercookieobject[cookiename];
          } else {
            usercookieobject[cookiename] = {name: cookiename, value: getCookieString(split[i]), domain: getCookieDomain(split[i]), path: getCookiePath(split[i])};
            //usercookieobject[cookiename] = {value: getCookieString(split[i]), domain: getCookieDomain(split[i]), path: getCookiePath(split[i])};
            //dump("\n -- setting "+cookiename +" domain: "+usercookieobject[cookiename].domain+" path:"+usercookieobject[cookiename].path);
          }

          //dump(split[i]);
          // XXX: gmail specific stuff here
          /*if (split[i].indexOf("GX=") > -1) {
            if (expired) {
              usercookieobject.GX = "";
            } else {
              newcookie = split[i].match(/\GX=[a-zA-Z0-9_-]*;/);
              usercookieobject.GX = newcookie;
            }
          } else if (split[i].indexOf("LSID=") > -1) {
            if (expired) {
              usercookieobject.LSID = "";
            } else {
              newcookie = getCookieString(split[i]);
              usercookieobject.LSID = newcookie;
            }
          } else if (split[i].indexOf("SID=") > -1) {
            if (expired) {
              usercookieobject.SID = "";
            } else {
              newcookie = split[i].match(/\SID=[a-zA-Z0-9_-]*;/);
              usercookieobject.SID = newcookie;
            }
          } else if (split[i].indexOf("HID=") > -1) {
            if (expired) {
              // XXX: we need HID when you load hosted webmail, but why
              // is it being removed?
              //usercookieobject.HID = "";
            } else {
              newcookie = split[i].match(/\HID=[a-zA-Z0-9_-]*;/);
              usercookieobject.HID = newcookie;
            }
          } else if (split[i].indexOf("GXAS=") > -1) {
            if (expired) {
              usercookieobject.GXAS = "";
            } else {
              newcookie = split[i].match(/\GXAS=[a-zA-Z0-9_.=-]*;/);
              usercookieobject.GXAS = getCookieString(split[i]);
            }
          } else if (split[i].indexOf("GXAS_SEC=") > -1) {
            if (expired) {
              usercookieobject.GXAS_SEC = "";
            } else {
              newcookie = split[i].match(/\GXAS_SEC=[a-zA-Z0-9_.=-]*;/);
              usercookieobject.GXAS_SEC = getCookieString(split[i]);
            }
          } else if (split[i].indexOf("S=") == 0) {
            if (expired) {
              usercookieobject.S = "";
            } else {
              newcookie = getCookieString(split[i]);
              //dump("\n\nnew cookie: |"+newcookie+"|\n\n");
              usercookieobject.S = newcookie;
            }
          }*/
        }

        // make sure we don't store the Set-Cookie directive by making it empty
        httpChannel.setResponseHeader("Set-Cookie", "", false);
      }
      break;
  }
}

nsNotifierService.prototype.showNotification = function(aUsername) {
  // when the alert callback happens, we want to notify the listener that
  // initiated the server connection that the alert was clicked.
  // Simply pushing a state change to all listeners will result in the
  // infinite window open loop!
  this.logItem("Alert Clickback called for " + aUsername + ":");
  this.logItem("  Notification Window is: (" + this.notificationListenerID + ").");

  var run = 0;
  if (this.notificationListenerID) {
    var done = false;
    while (!done && (run < this.listeners.length)) {
      this.logItem("  Item " + run +  " has id (" + this.listeners[run].getID() + ")");
      if (this.listeners[run] && (this.listeners[run].getID() == this.notificationListenerID))
        done = true;
      else 
        run++;
    }
  } else {
    // fallback
    while ((this.listeners[run] == null) && (run < this.listeners.length))
      run++;

    this.logItem("  No notification window found, call listener #" + run);
  }

  if (this.listeners[run]) {
    this.listeners[run].onStateChange(aUsername, nsINotifierProgressListener.LOAD_MAIL);
  }
}

nsNotifierService.prototype.createFolder = function(aName, aUnreadMail) {
  return {
    name: aName,
    unreadMail: aUnreadMail
  }
}

/* Pref code */
nsNotifierService.prototype.getPrefBranch = function(){
  if (!this.prefBranch) {
    this.prefBranch = Components.classes['@mozilla.org/preferences-service;1'];
    this.prefBranch = this.prefBranch.getService();
    this.prefBranch = this.prefBranch.QueryInterface(Components.interfaces.nsIPrefBranch);
  }

  return this.prefBranch;
}

nsNotifierService.prototype.prefChanged = function(aPrefName) {
  switch (aPrefName) {
    case "gm-notifier.update.interval":
      this.setTimeout(this.getPrefBranch().getIntPref("gm-notifier.update.interval"));
      break;

    case "gm-notifier.multiaccount.enabled":
      if (!this.supportsMultiMode()) {
        this.multiuser = false;
      } else {
        this.multiuser = this.getPrefBranch().getBoolPref("gm-notifier.multiaccount.enabled");
      }

      this.buildUserQueue();

      if (!this.multiuser) {
        // build a new user list

        // log out every user other than the default user
        for (name in this.userList) {
          if (name != this.defaultUser) {
            this.logoutUser(name);
          }
        }
      }
      break;

    case "gm-notifier.users.default":
      try {
        this.defaultUser = this.getPrefBranch().getCharPref("gm-notifier.users.default");
      } catch (e) {}
      break;
  }
}

nsNotifierService.prototype.addPrefObserver = function(aDomain, aFunction){
  var myPrefs = this.getPrefBranch();
  var prefBranchInternal = myPrefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);

  if (prefBranchInternal) {
    prefBranchInternal.addObserver(aDomain, aFunction, false);
  }
}

/* Bundle code */
nsNotifierService.prototype.getStringBundle = function() {
  if (!this.stringBundle) {
    var strBundleService = Components.classes["@mozilla.org/intl/stringbundle;1"]
                             .createInstance(Components.interfaces.nsIStringBundleService);

    this.stringBundle = strBundleService.createBundle("chrome://gm-notifier/locale/gm-notifier.properties");
  }

  return this.stringBundle;
}

nsNotifierService.prototype.getString = function(aName) {
  return this.getStringBundle().GetStringFromName(aName);
}

nsNotifierService.prototype.getFormattedString = function(aName, aStrArray) {
  return this.getStringBundle().formatStringFromName(aName, aStrArray, aStrArray.length);
}

nsNotifierService.prototype.getLoginDetails = function(aUsername) {
  var url = "chrome://gm-notifier/";

  // check for toolkit's login manager (Mozilla 1.9)
  if (Components.classes[kLOGINMANAGER_CONTRACTID]) {
    var passwordManager = Components.classes[kLOGINMANAGER_CONTRACTID].getService(nsILoginManager);
    var logins = passwordManager.findLogins({}, url, null, "gm-notifier");

    for (var i = 0; i < logins.length; i++) {
      if (logins[i].username == aUsername) {
        var password = logins[i].password;
        if (password === " ") {
          // XXX: empty password is " " for now due to ff3 change
          return "";
        } else {
          return password;
        }
      }
    }
  } else {
    var passwordManager = Components.classes[kPSWDMANAGER_CONTRACTID]
                          .createInstance(nsIPasswordManagerInternal);
    var host = {value:""};
    var user =  {value:""};
    var password = {value:""};

    try {
      passwordManager.findPasswordEntry(url, aUsername, "", host, user, password);
    } catch(e){ }

    return password.value;
  }
}

nsNotifierService.prototype.getPassword = function(aUsername) {
  var password = "";

  if (this.userList[aUsername]) {
    password = this.userList[aUsername].password;
  }

  if (!password) {
    password = this.getLoginDetails(aUsername);
  }

  return password;
}

nsNotifierService.prototype.getURLProtocol = function() {
  /*var urlprotocol = "";
  if (this.getPrefBranch().getBoolPref("gm-notifier.connection.use.unsecured")) {
    urlprotocol = "http://";
  } else {
    urlprotocol = "https://";
  }

  return urlprotocol;*/
  return "https://";
}

nsNotifierService.prototype.supportsMultiMode = function() {
  var supports = false;

  try {
    var appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
                            .getService(Components.interfaces.nsIXULAppInfo);
    if (appInfo.platformVersion >= "1.8.1") {
      supports = true;
    }
  } catch (e) {}

  return supports;
}

nsNotifierService.prototype.newUserListItem = function(aUsername, aPassword) {
  if (!this.userList[aUsername]) {
    this.userCount++;
  }

  return {
    name: aUsername,
    password: aPassword,
    resetState: false,
    newMailMode: false,
    folders: new Array(),
    unreadEmails: null,
    tmpUnreadEmails: null,
    newEmails: 0,
    space_used_mb: null,
    space_used_percent: null,
    total_mb: null,
    inboxUnread: 0,
    inboxNew: 0,
    state: nsINotifierService.USER_STATE_LOGGED_OUT,
    cookieObject: new Object()
  }
}

nsNotifierService.prototype.hitch = function(aScope, aFunction) {
  function toArray(aObj) {
    var arr = [];
    for (var i = 0; i < aObj.length; i++) {
      arr.push(aObj[i]);
    }

    return arr;
  }

  var origArgs = toArray(arguments);
  origArgs.splice(0, 2);

  return function() {
    var newArgs = toArray(arguments);
    // add origArgs to end
    for (var i = 0; i < origArgs.length; i++) {
      newArgs.push(origArgs[i]);
    }

    aFunction.apply(aScope, newArgs)
  }
}

/**
 * JS XPCOM component registration goop:
 *
 * We set ourselves up to observe the xpcom-startup category.  This provides
 * us with a starting point.
 */

nsNotifierService.prototype.QueryInterface = function(iid) {
  if (!iid.equals(nsINotifierService) &&
      !iid.equals(Components.interfaces.nsIObserver) &&
      !iid.equals(nsISupports))
    throw Components.results.NS_ERROR_NO_INTERFACE;
  return this;
}

var nsNotifierServiceModule = new Object();

nsNotifierServiceModule.registerSelf = function (compMgr, fileSpec, location, type) {
  compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
  compMgr.registerFactoryLocation(kGMSERVICE_CID,
                                  "nsIGMNotifierService",
                                  kGMSERVICE_CONTRACTID,
                                  fileSpec,
                                  location,
                                  type);
}

nsNotifierServiceModule.getClassObject = function (compMgr, cid, iid) {
  if (!cid.equals(kGMSERVICE_CID)) {
    throw Components.results.NS_ERROR_NO_INTERFACE;
  }

  if (!iid.equals(Components.interfaces.nsIFactory)) {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  }

  return nsNotifierServiceFactory;
}

nsNotifierServiceModule.canUnload = function (compMgr) {
  // cleanup
  this.listeners = null;

  if (this.updateTimer) {
    this.updateTimer.cancel();
  }

  this.updateTimer = null;

  this.observerService = null;

  return true;
}

var nsNotifierServiceFactory = new Object();

nsNotifierServiceFactory.createInstance = function (outer, iid) {
  if (outer != null) {
    throw Components.results.NS_ERROR_NO_AGGREGATION;
  }

  if (!iid.equals(nsINotifierService) && !iid.equals(nsISupports)) {
    throw Components.results.NS_ERROR_NO_INTERFACE;
  }

  return new nsNotifierService();
}

function NSGetModule(compMgr, fileSpec) {
  return nsNotifierServiceModule;
}

