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

const nsIGMNotifierProgressListener = Components.interfaces.nsIGMNotifierProgressListener;
const nsIGMNotifierService = Components.interfaces.nsIGMNotifierService;

function gm_notifier() {
  // are we logged in?
  this.is_logged_in = false;
  // the listener id the notifier service assigned to us
  this.listenerID = null;
  // the login window
  this.login_window = null;
  // ever logged in
  this.has_ever_logged_in = false;

  this.nsIGMNotifierService = null;
  this.nsIGMNotifierProgressListener = null;

  // notifier preference class
  this.wm_prefs = new gm_prefs();
  this.wm_prefs.initPrefs();

  // should we reset the counter when the UI loads webmail.
  this.reset_counter = this.wm_prefs.getBoolPref(this.wm_prefs.PREF_LOAD_RESET_COUNTER);

  this.defaultUser = this.wm_prefs.getCharPref(this.wm_prefs.PREF_DEFAULT_USER);

  this.multi_mode = null;

  // add pref observers
  this.PrefChangeObserver = {
    observe: function(aSubject, aTopic, aData)
    {
      gGMailNotifier.prefChanged(aData);
    }
  };

  this.wm_prefs.addObserver("gm-notifier", this.PrefChangeObserver);
}

/**
 * Gets called when a notifier preference changes
 *
 * @param aPrefName - string containing the name of the preference that was changed
 */
gm_notifier.prototype.prefChanged = function(aPrefName) {
  switch(aPrefName){
    case gGMailNotifier.wm_prefs.PREF_STATUSBAR_ENABLED:
      gGMailNotifier.showStatusbarItem();
      break;

    case gGMailNotifier.wm_prefs.PREF_LOAD_RESET_COUNTER:
      gGMailNotifier.reset_counter =
        gGMailNotifier.wm_prefs.getBoolPref(gGMailNotifier.wm_prefs.PREF_LOAD_RESET_COUNTER);
      break;

    case gGMailNotifier.wm_prefs.PREF_USE_FOLDERVIEW:
      var showFolders = gGMailNotifier.wm_prefs.getBoolPref(gGMailNotifier.wm_prefs.PREF_USE_FOLDERVIEW);
      if (document.getElementById("gm-notifier-toolbar-item")) {
        document.getElementById("gm-notifier-toolbar-item").setAttribute("showFolders", showFolders);
      }

      document.getElementById("gm-tooltip-row").collapsed = !showFolders;
      break;

    case gGMailNotifier.wm_prefs.PREF_COUNTER_SHOW_INBOX:
      gGMailNotifier.updateLabels(null, true);
      break;

    case gGMailNotifier.wm_prefs.PREF_STATUSBAR_POSITION:
      gGMailNotifier.updateStatusBarPosition();
      break;

    case gGMailNotifier.wm_prefs.PREF_DEFAULT_USER:
      gGMailNotifier.defaultUserChanged();
      break;

    case gGMailNotifier.wm_prefs.PREF_MULTIACCOUNT_ENABLED:
      // multi account enabled/disabled
      gGMailNotifier.toggleMultiAccountMode();
      break;
  }
}

/**
 * Gets called when someone clicks on the notifier icon, handles middle click
 *
 * @param aEvent - the event
 */
gm_notifier.prototype.openMiddleClick = function(aEvent) {
  // middle click should open in new tab
  if ((this.is_logged_in) && (aEvent) && (aEvent.button == 1)) {
    this.setNewMailMode(this.defaultUser, false);
    this.loadWebmail(1);
  }
}

/**
 * Opens the webmail into the browser, depending on the preference value:
 * 0 - current tab
 * 1 - new tab
 * 2 - new window 
 * 3 - new unfocused tab
 *
 * @param aOverride - force a certain load method
 */
gm_notifier.prototype.loadWebmail = function(aOverride, aUsername) {
  var username = aUsername;
  if (!username) {
    username = this.defaultUser;
  }

  var user = username;
  if (!this.nsIGMNotifierService.isHostedDomain(user)) {
    var domain = this.nsIGMNotifierService.getHostedDomain(user);
    if (!domain) {
      user += "@gmail.com";
    }
  }

  this.setNewMailMode(username, false);

  // should we reset the counter
  if (this.reset_counter) {
    this.nsIGMNotifierService.setResetState(username, true);
  }

  var reusetab = true;

  try {
    reusetab = !this.wm_prefs.getBoolPref(this.wm_prefs.PREF_DISABLE_TAB_REUSE);
  } catch (e) {}

  this.nsIGMNotifierService.loadUserCookies(username);

  if (reusetab) {
    // http://developer.mozilla.org/en/docs/XPCNativeWrapper#XPCNativeWrapper_constructor_call_with_string_arguments
    // alert(contentWinWrapper.frames["js"].ma);
    // try to reuse tab

    var done = false;
    var tabbrowser = getBrowser();

    for (var i = 0; i < tabbrowser.mTabContainer.childNodes.length; i++) {
      var tab = tabbrowser.mTabContainer.childNodes[i];
      var browser = tab.linkedBrowser;

      var host = "", path ="";

      try {
        host = browser.currentURI.host;
        path = browser.currentURI.path;
      } catch (e){}

      if (host == "mail.google.com" && path.indexOf("/mail" == 0)) {
        // we have a gmail browser
        var contentWinWrapper = new XPCNativeWrapper(browser.contentWindow, "window")

        // could possibly use idkey rather than username
        if (typeof(contentWinWrapper.window.globals) != "undefined" && typeof(contentWinWrapper.window.globals.USER_EMAIL) == "string" && contentWinWrapper.window.globals.USER_EMAIL == user) {
          getBrowser().selectedTab = tab;

          // reload the tab
          // XXX: figure out to do this from within gmail
          getBrowser().reloadTab(getBrowser().selectedTab);
          done = true;
          break;
        } else if (typeof(contentWinWrapper.window.GLOBALS) != "undefined" && typeof(contentWinWrapper.window.GLOBALS[10]) == "string" && contentWinWrapper.window.GLOBALS[10] == user) {
          // Also - GLOBALS
          getBrowser().selectedTab = tab;

          // reload the tab
          // XXX: figure out to do this from within gmail
          getBrowser().reloadTab(getBrowser().selectedTab);
          done = true;
          break;
        }
        /*old 1.0 gmail code
        var jsframe = contentWinWrapper.frames["js"];

        for (prop in jsframe) {
          if (typeof(jsframe[prop]) == "string" && jsframe[prop] == user) {
            getBrowser().selectedTab = tab;
            done = true;

            var mainwindow = contentWinWrapper.frames[0].frames["v1"];

            var refresh = mainwindow.document.getElementById("rfr");
            if (refresh) {
              var mouseevent = document.createEvent("MouseEvents");
              mouseevent.initMouseEvent("mousedown", true, false, mainwindow,
                                        0, 0, 0, 0, 0, false, false, false, false, 0, null);
              var cancel = refresh.dispatchEvent(mouseevent);
            }
            break;
          }
        }*/
      }
    }

    if (done) {
      return;
    }
  }

  var webmailUrl = "mail.google.com/mail";
  var url = this.createURL(webmailUrl, true, username);

  if (this.wm_prefs.getBoolPref(this.wm_prefs.PREF_USE_GMAIL_1_0)) {
    url += "/?ui=1";
  }

  /* if inbox counter is shown, show inbox, else unread view
  if (this.wm_prefs.getBoolPref(this.wm_prefs.PREF_COUNTER_SHOW_INBOX))
    url = "https://mail.google.com/mail";
  else
    url = "https://mail.google.com/mail/?search=query&q=is%3Aunread&view=tl&start=0"*/

  // where to load the webmail into
  var location = aOverride ? aOverride : this.wm_prefs.getIntPref(this.wm_prefs.PREF_LOAD_LOCATION);

  if (getBrowser().mCurrentBrowser.currentURI.spec == "about:blank") {
    // if the current tab is empty, use it
    getBrowser().loadURI(url);
  } else if (location == 2) {
    window.open(url);
  } else if ((location == 1) || (location == 3)){
    var myTab = getBrowser().addTab(url, null, null);

    // focus tab only if location is 1
    if (location == 1) {
      getBrowser().selectedTab = myTab;
    }
  } else {
    getBrowser().loadURI(url);
  }

  //this.updateLabels(true);
}

gm_notifier.prototype.createURL = function(aUrl, aHasDomain, aUsername) {
  var url = aUrl;

  var username = aUsername;
  if (!username) {
    username = this.defaultUser;
  }

  var hashosteddomain = this.nsIGMNotifierService.isHostedDomain(username);

  // XXX: big hack here for hosted domains!
  if (aUrl.indexOf("http://") == -1 && aUrl.indexOf("https://") == -1) {
    if (!aHasDomain || hashosteddomain) {
      // add the main url
      if (hashosteddomain) {
        var hosteddomain = username.substring(username.indexOf("@")+1, username.length);
        url = "mail.google.com/a" + "/" + hosteddomain;
        if (!aHasDomain) {
          url += aUrl;
        }
      } else {
        url = "mail.google.com/mail" + url;
      }
    }

    /*if (this.wm_prefs.getBoolPref(this.wm_prefs.PREF_UNSECURED_CONNECTION)) {
      url = "http://" + url;
    } else {*/
      url = "https://" + url;
    //}
  }

  //url = "https://www.google.com/accounts/ServiceLoginAuth?service=mail&Email="+encodeURIComponent(username)+"&Passwd="+encodeURIComponent(this.nsIGMNotifierService.getPassword(username))+"&continue="+url;


  return url;
}

/**
 * Gets called when someone clicks on the notifier icon
 *
 * @param aEvent - the event
 */
gm_notifier.prototype.login = function(aEvent) {
  // on windows, right click calls this method
  if (aEvent && (aEvent.button == 2)) {
    return;
  }

  // if it is a menuitem, then it is a folder dropdown
  if (aEvent.target.tagName == "menuitem") {
    gGMailNotifier.loadFolder(aEvent.target);
  } else if (!this.is_logged_in) {
    this.openLoginWindow();
  } else {
    // middle click should open in new tab - from statusbar
    if ((this.is_logged_in) && aEvent) {
      if (aEvent.button == 1) {
        this.loadWebmail(1);
      } else if (aEvent.ctrlKey) {
        this.loadWebmail(1);
      } else {
        this.loadWebmail();
      }
    } else {
      this.loadWebmail();
    }
  }
}

/**
 * Opens the login window and stores a reference to it
 *
 */
gm_notifier.prototype.openLoginWindow = function() {
  if (this.multi_mode && this.supportsMultiMode()) {
    if (this.nsIGMNotifierService.getUserCount() == 0) {
      // if no users exist, open the accounts window
      this.loadAccountsWindow();
    } else {
      window.openDialog("chrome://gm-notifier/content/gm-login-multi.xul", "_blank", "chrome,resizable=yes,dependent=yes");
    }
  } else {
    this.login_window = window.openDialog("chrome://gm-notifier/content/gm-login.xul", "_blank", "chrome,resizable=yes,dependent=yes");
  }
}

/**
 * Called by the login window
 *
 * @param aUserName - the username
 * @param aPassword - the password
 */
gm_notifier.prototype.initLogin = function(aUserName, aPassword) {
  this.user_name = aUserName;
  this.password = aPassword;

  this.setLoginWindowStatus(1);
  this.startLoginProcess();
}

/**
 * Changes state of the login window
 *
 * @param aStatusNum
 */
gm_notifier.prototype.setLoginWindowStatus = function (aStatusNum) {
  if (this.login_window && this.login_window.document)
    this.login_window.setStatus(aStatusNum);
}

/**
 * Starts the login process
 *
 */
gm_notifier.prototype.startLoginProcess = function() {
  gGMailNotifier.nsIGMNotifierService.initLogin(gGMailNotifier.user_name, gGMailNotifier.password, gGMailNotifier.listenerID);
  gGMailNotifier.has_ever_logged_in = true;
}

/**
 * Checks for new mail
 *
 */
gm_notifier.prototype.checkNow = function() {
  if (this.is_logged_in){
    this.setNewMailMode(this.defaultUser, false);
    this.nsIGMNotifierService.checkNow();
  } else {
    this.openLoginWindow();
  }
}

/**
 * Logs out the user
 *
 */
gm_notifier.prototype.logout = function() {
  this.setNewMailMode(this.defaultUser, false);
  this.nsIGMNotifierService.logout();
}

/**
 * Gets the default (current) user name
 *
 */
gm_notifier.prototype.getDefaultUserName = function() {
  return this.defaultUser;
}

/**
 * Load's a folder from the webmail
 *
 */
gm_notifier.prototype.loadFolder = function(aElement) {
  var url;
  if (aElement.hasAttribute("folderName")) {
    this.setNewMailMode(this.defaultUser, false);
    url = this.createURL("/mail?&search=cat&cat={folder}&view=tl");

    var folderName;
    var folderType = aElement.getAttribute("folderType");
    if (folderType == "inbox")
      folderName = "Inbox";
    else
      folderName = aElement.getAttribute("folderName");

    url = url.replace("{folder}", encodeURI(folderName));
  } else {
    // compose mail
    url = this.createURL("/mail?view=cm&fs=1&tearoff=1&fs=1");
  }

  this.nsIGMNotifierService.loadUserCookies(this.defaultUser);

  var location = this.wm_prefs.getIntPref(this.wm_prefs.PREF_LOAD_LOCATION);

  if (location == 2) {
    window.open(url);
  } else if ((location == 1) || (location == 3)) {
    var myTab = getBrowser().addTab(url, null, null);

    // focus tab only if location is 1
    if (location == 1) {
      getBrowser().selectedTab = myTab;
    }
  } else {
    getBrowser().loadURI(url);
  }
}

/**
 * Notifier Progress Listener implementation
 *
 */
gm_notifier.prototype.NotifierProgressListener = function() {
  return ({
    id : null,

    getID : function () { return this.id; },

    onStateChange : function (aUsername, aState) {
      var toolbarItem = document.getElementById("gm-notifier-toolbar-item");
      if (toolbarItem)
        toolbarItem.removeAttribute("loading");

      var defaultUser = gGMailNotifier.getDefaultUserName();

      if (aState == nsIGMNotifierProgressListener.LOGIN_INITIATED) {
        if (aUsername == defaultUser) {
          // called when login has been initiated by user
          if (toolbarItem) {
            toolbarItem.setAttribute("loading", "true");
          }

          if (document.getElementById("gm-notifier-toolbar-stack")) {
            document.getElementById("gm-notifier-toolbar-stack").setAttribute("selectedIndex", 2);
          }
        }
      } else if (aState == nsIGMNotifierProgressListener.NO_NEW_MAIL) {
        if (aUsername == defaultUser) {
          // no new mail, but the mail count might have decreased!
          gGMailNotifier.updateLabels(false);
        }
      } else if (aState == nsIGMNotifierProgressListener.NEW_MAIL) {
        if (aUsername == defaultUser) {
          // set UI labels
          gGMailNotifier.updateLabels(false);
        }
      } else if (aState == nsIGMNotifierProgressListener.LOGIN_FAILED) {
        // if we failed and not a login window attempt, don't logout ui
        if (gGMailNotifier.login_window && gGMailNotifier.login_window.document) {
          gGMailNotifier.setLoginWindowStatus(3);
          gGMailNotifier.is_logged_in = false;
          gGMailNotifier.updateLabels(false);
          document.getElementById("gm-context-menu-logout").setAttribute("disabled", true);
        }
      } else if (aState == nsIGMNotifierProgressListener.LOGIN_DETAILS_INVALID) {
        // if we failed and not a login window attempt, don't logout ui
        if (gGMailNotifier.login_window && gGMailNotifier.login_window.document) {
          gGMailNotifier.setLoginWindowStatus(4);
          gGMailNotifier.is_logged_in = false;
          gGMailNotifier.updateLabels(false);
          document.getElementById("gm-context-menu-logout").setAttribute("disabled", true);
        }
      } else if (aState == nsIGMNotifierProgressListener.LOGIN_SUCCESS) {
        // set login flags
        gGMailNotifier.has_ever_logged_in = true;

        // update the login window
        gGMailNotifier.setLoginWindowStatus(2);
      } else if (aState == nsIGMNotifierProgressListener.LOGOUT) {
        // clean up on logout
        if (gGMailNotifier.is_logged_in) {
          gGMailNotifier.is_logged_in = false;

          document.getElementById("gm-context-menu-logout").setAttribute("disabled", true);
          gGMailNotifier.updateLabels(false);
        }
      } else if (aState == nsIGMNotifierProgressListener.LOGOUT_USER) {
        // no need to worry about if no users are logged in anymore, the core
        // service will call LOGOUT on us.
        gGMailNotifier.updateLabels(false);
        gGMailNotifier.buildAccountsSubmenu();
      } else if (aState == nsIGMNotifierProgressListener.LOAD_MAIL) {
        // called when notification gets clicked
        gGMailNotifier.loadWebmail(null, aUsername);
      } else if (aState == nsIGMNotifierProgressListener.ACCOUNTS_CHECK_COMPLETED) {
        gGMailNotifier.onFinishLoginLoad();
        gGMailNotifier.buildAccountsSubmenu();
      } else if (aState == nsIGMNotifierProgressListener.NOTIFIER_LOGGED_IN) {
        if (!gGMailNotifier.is_logged_in) {
          gGMailNotifier.is_logged_in = true;

          // if the default user is logged in and we get NOTIFIER_LOGGED_IN,
          // that means we are a new window, so build the UI.
          if (gGMailNotifier.nsIGMNotifierService.getUserState(defaultUser) == nsIGMNotifierService.USER_STATE_LOGGED_IN) {
            gGMailNotifier.updateLabels(false);
            gGMailNotifier.buildAccountsSubmenu();
            gGMailNotifier.mailModeChanged(defaultUser);
          }
        }
      } else if (aState == nsIGMNotifierProgressListener.USER_MODE_CHANGED) {
        if (aUsername == defaultUser) {
          gGMailNotifier.mailModeChanged(aUsername);
        }
      }
    },

    QueryInterface : function(aIID) {
      if (aIID.equals(nsIGMNotifierProgressListener) ||
          aIID.equals(Components.interfaces.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
    }
  });
}

/**
 * Called when the login process has been completed
 *
 */
gm_notifier.prototype.onFinishLoginLoad = function() {
  // ui
  var showFolders = gGMailNotifier.wm_prefs.getBoolPref(gGMailNotifier.wm_prefs.PREF_USE_FOLDERVIEW);
  if (document.getElementById("gm-notifier-toolbar-item")) 
    document.getElementById("gm-notifier-toolbar-item").setAttribute("showFolders", showFolders);

  document.getElementById("gm-tooltip-row").collapsed = !showFolders;

  // set UI labels
  //this.updateLabels(false);

  document.getElementById("gm-context-menu-logout").setAttribute("disabled", false);
}

/**
 * Login window calls this if we need to store the login details
 *
 */
gm_notifier.prototype.storeLoginDetails = function(aStorePassword) {
  var url = "chrome://gm-notifier/";

  if (Components.classes["@mozilla.org/login-manager;1"]) {
    var passwordManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);

    if (!passwordManager) {
      return;
    }

    var passwords = passwordManager.findLogins({}, url, null, "gm-notifier");
    if (passwords.length > 0) {
      for (var i = 0; i < passwords.length; i++) {
        if (passwords[i].username == this.user_name) {
          passwordManager.removeLogin(passwords[i]);
          break;
        }
      }
    }

    var logininfo = Components.classes["@mozilla.org/login-manager/loginInfo;1"].createInstance(Components.interfaces.nsILoginInfo);

    if (aStorePassword) {
      this.wm_prefs.setBoolPref("gm-notifier.users.remember-password", true);
      this.wm_prefs.setCharPref("gm-notifier.users.default", this.user_name);
      logininfo.init(url, null, "gm-notifier", this.user_name, this.password, "", "");
      passwordManager.addLogin(logininfo);
    } else {
      // if we don't store the password, we store the user name only
      // XXX: FF3 doesn't allow empty/null names - using " ", need to reconsider
      logininfo.init(url, null, "gm-notifier", this.user_name, " ", "", "");
      passwordManager.addLogin(logininfo);
    }
  } else {
    var passwordManager = Components.classes["@mozilla.org/passwordmanager;1"].createInstance();

    if (passwordManager) {
      passwordManager = passwordManager.QueryInterface(Components.interfaces.nsIPasswordManager);

      try {
        passwordManager.removeUser(url, this.user_name);
      } catch (e) {}

      if (aStorePassword) {
        this.wm_prefs.setBoolPref("gm-notifier.users.remember-password", true);
        this.wm_prefs.setCharPref("gm-notifier.users.default", this.user_name);
        passwordManager.addUser(url, this.user_name, this.password);
      } else {
        // if we don't store the password, we store the user name only
        passwordManager.addUser(url, this.user_name, "");
      }
    }
  }
}

gm_notifier.prototype.updateLabels = function(aIconClicked, aSkipNewMailCheck) {
  // update the UI objects
  document.getElementById("gm-notifier-statusbar").setAttribute("logged-in", this.is_logged_in);

  if (document.getElementById("gm-notifier-toolbar-item"))
    document.getElementById("gm-notifier-toolbar-item").setAttribute("logged-in", this.is_logged_in);

  if (this.is_logged_in) {
    var unread = this.nsIGMNotifierService.getDisplayCount(this.defaultUser);
    var newCount = this.nsIGMNotifierService.getNewCount(this.defaultUser);

    if (!aSkipNewMailCheck && !this.nsIGMNotifierService.getNewMailMode(this.defaultUser) && (newCount > 0)) {
      //this.setNewMailMode(this.defaultUser, true);
    }

    if (document.getElementById("gm-notifier-toolbar-item")) {
      document.getElementById("gm-notifier-toolbar-item").setAttribute("unread", unread);
    }

    if (document.getElementById("gm-notifier-statusbar")) {
      document.getElementById("gm-notifier-statusbar").setAttribute("label", unread ? unread : "");
    }

    // tooltip labels
    document.getElementById("gm-notifier-tooltip-labels").hidden = false;

    var myTooltipRows = document.getElementById("gm-tooltip-row");
    var dropdownLabels = document.getElementById("gm-notifier-toolbar-item-menupopup");

    // clear current tooltip entries
    for (var run = myTooltipRows.childNodes.length; run--; run > 0){
      myTooltipRows.removeChild(myTooltipRows.childNodes.item(run));
    }

    if (dropdownLabels) {
      // clear current dropdown entries
      for (var run = dropdownLabels.childNodes.length; run--; run > 0) {
        dropdownLabels.removeChild(dropdownLabels.childNodes.item(run));
      }
    }

    // handle folders
    var folderLength = this.nsIGMNotifierService.getFolderCount(this.defaultUser);
    var foldername;

    for (var run = 0; run < folderLength; run++) {
      var folderItem = this.nsIGMNotifierService.getFolderItem(this.defaultUser, run, {});

      var myRow = document.createElement("row");

      var myLabel = document.createElement("label");

      foldername = unescape(folderItem[0]);
      if (run == 0) {
        // inbox is always first
        foldername = this.getString("InboxTitle");
      }

      myLabel.setAttribute("value", foldername);
      myRow.appendChild(myLabel);

      myLabel = document.createElement("label");
      myLabel.setAttribute("value", folderItem[1]);
      myRow.appendChild(myLabel);

      myTooltipRows.appendChild(myRow);

      // handle dropdown
      if (dropdownLabels) {
        var myMenuitem = document.createElement("menuitem");
        myMenuitem.setAttribute("label", foldername + ": " + folderItem[1]);
        myMenuitem.setAttribute("folderName", foldername);

        // inbox?
        if (run == 0) {
          myMenuitem.setAttribute("folderType", "inbox")
        } else {
          myMenuitem.setAttribute("folderType", "folder")
        }

        dropdownLabels.appendChild(myMenuitem);
      }
    }

    if (dropdownLabels) {
      // compose item
      var temp = document.createElement("menuseparator");
      dropdownLabels.appendChild(temp);
      temp = document.createElement("menuitem");
      temp.setAttribute("label", this.getString("ComposeMailLabel"));
      temp.setAttribute("accesskey", this.getString("ComposeMailAccesskey"));
      dropdownLabels.appendChild(temp);
    }

  } else {
    if (document.getElementById("gm-notifier-toolbar-item"))
      document.getElementById("gm-notifier-toolbar-item").setAttribute("unread", "");

    if (document.getElementById("gm-notifier-statusbar"))
      document.getElementById("gm-notifier-statusbar").setAttribute("label", "");

    document.getElementById("gm-notifier-tooltip-labels").hidden = true;
  }

  if (this.multi_mode) {
    this.setMultiModeUI();
  }
}

gm_notifier.prototype.setNewMailMode = function(aUsername, aValue) {
  this.nsIGMNotifierService.setNewMailMode(aUsername, aValue);
}

gm_notifier.prototype.getLoginDetails = function(aUsername){
  var url = "chrome://gm-notifier/";

  // check for toolkit's login manager (Mozilla 1.9)
  if (Components.classes["@mozilla.org/login-manager;1"]) {
    var passwordManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
    var logins = passwordManager.findLogins({}, url, null, "gm-notifier");

    for (var i = 0; i < logins.length; i++) {
      if (logins[i].username == aUsername) {
        password = logins[i].password;

        // XXX: why not call the service here to get password?
        if (password === " ") {
          // XXX: empty password is " " for now due to ff3 change
          password = "";
        }

        return password;
      }
    }
  } else {
    var passwordManager = Components.classes["@mozilla.org/passwordmanager;1"].createInstance(Components.interfaces.nsIPasswordManagerInternal);
    var host = {value:""};
    var user =  {value:""};
    var password = {value:""}; 

    try {
      passwordManager.findPasswordEntry(url, aUsername, "", host, user, password);
    } catch(e){ }

    return password.value;
  }

  return null
}

gm_notifier.prototype.showStatusbarItem = function(aShowItem) {
   if (aShowItem != null){
     this.wm_prefs.setBoolPref(this.wm_prefs.PREF_STATUSBAR_ENABLED, aShowItem);
   }

   var prefValue = aShowItem ? aShowItem : this.wm_prefs.getBoolPref(this.wm_prefs.PREF_STATUSBAR_ENABLED);

   document.getElementById("gm-notifier-statusbar").collapsed = !prefValue;
}

gm_notifier.prototype.updateStatusBarPosition = function() {
  var index = this.wm_prefs.getIntPref(this.wm_prefs.PREF_STATUSBAR_POSITION);

  if (index < 1)
    return;

  var statusBar = document.getElementById("status-bar");
  var children = statusBar.childNodes;

  var statusbarItem = document.getElementById("gm-notifier-statusbar");
  var newStatusbarItem = statusBar.removeChild(statusbarItem);

  if ((children.length == 0) || (index >= children.length))
    statusBar.appendChild(newStatusbarItem);
  else
    statusBar.insertBefore(newStatusbarItem, children[index-1]);
}

gm_notifier.prototype.loadPrefWindow = function() {
  window.openDialog("chrome://gm-notifier/content/gm-preferences.xul", "", "centerscreen,chrome,resizable=no,dependent=yes")
}

gm_notifier.prototype.getString = function(aName) {
  var strbundle = document.getElementById("gm-notifier-stringbundle");
  return strbundle.getString(aName);
}

gm_notifier.prototype.getFormattedString = function(aName, aStrArray) {
  var strbundle = document.getElementById("gm-notifier-stringbundle");
  return strbundle.getFormattedString(aName, aStrArray);
}

gm_notifier.prototype.fillInTooltip = function(aTooltipElement) {
  document.getElementById("gm-notifier-tooltip-logged-in").collapsed = !this.is_logged_in;
  document.getElementById("gm-notifier-tooltip-logged-out").collapsed = this.is_logged_in;

  if (this.is_logged_in) {
    var username = this.getDefaultUserName();
    document.getElementById("gm-notifier-tooltip-username").value = username;

    document.getElementById("gm-notifier-tooltip-unread").value = 
      this.getFormattedString("TooltipUnread", [this.nsIGMNotifierService.getDisplayCount(username)]);

    document.getElementById("gm-notifier-tooltip-quota").value =
      this.getFormattedString("TooltipQuota", [this.nsIGMNotifierService.getUsedMB(username),
                                               this.nsIGMNotifierService.getSpaceUsed(username),
                                               this.nsIGMNotifierService.getTotalSpace(username)]);
  } else {
  }
}

gm_notifier.prototype.toggleMultiAccountMode = function() {
  if (!this.supportsMultiMode()) {
    this.multi_mode = false;
    return;
  }

  var value = this.wm_prefs.getBoolPref(this.wm_prefs.PREF_MULTIACCOUNT_ENABLED);

  if (value != this.multi_mode) {
    this.multi_mode = value;
    this.setMultiModeUI();
  }
}

gm_notifier.prototype.setMultiModeUI = function() {
  // show/hide the menuitem
  var contextmenu = document.getElementById("gm-notifier-context-menu-accounts");
  var contextmenu2 = document.getElementById("gm-notifier-context-menu-accounts-manage");

  if (contextmenu && contextmenu2) {
    if (this.multi_mode && this.supportsMultiMode()) {
      contextmenu2.collapsed = !this.is_logged_in;
      contextmenu.collapsed = this.is_logged_in;
    } else {
      contextmenu2.collapsed = true;
      contextmenu.collapsed = true;
    }
  }
}

gm_notifier.prototype.buildAccountsSubmenu = function() {
  var separator = document.getElementById("gm-notifier-context-menu-accounts-separator");

  if (!separator)
    return;

  this.setMultiModeUI();

  // clear
  var sibling = separator.nextSibling;
  while (sibling) {
    temp = sibling;
    sibling = sibling.nextSibling;

    separator.parentNode.removeChild(temp);
  }
  var usercount = this.nsIGMNotifierService.getQueueCount();

  for (var i = 0; i < usercount; i++) {
    var name =  this.nsIGMNotifierService.getQueueUserName(i);
    var state = this.nsIGMNotifierService.getUserState(name);

    // skip invalid details
    if (state == nsIGMNotifierService.USER_STATE_INVALID_DETAILS)
      continue;

    var menuitem = document.createElement("menuitem");
    menuitem.setAttribute("id", "gm-notifier-context-menu-accounts-list-" + name);
    menuitem.setAttribute("value", name);

    var str = name;

    // if logged in, show the count
    if (state == nsIGMNotifierService.USER_STATE_LOGGED_IN) {
      var count = this.nsIGMNotifierService.getDisplayCount(name);
      str += " (" + count + ")";
    }

    menuitem.setAttribute("label", str);
    menuitem.setAttribute("type", "radio");

    // if the default user, check it
    if (name == this.defaultUser) {
      menuitem.setAttribute("checked", "true");
      menuitem.style.fontWeight = "bold";
    }

    separator.parentNode.appendChild(menuitem);
  }
}

gm_notifier.prototype.accountSwap = function(aEvent) {
  var name = aEvent.target.getAttribute("value");

  // no value or is the default user already, do nothing.
  if (!name || name == gGMailNotifier.defaultUser) {
    return;
  }

  var currentItem = document.getElementById("gm-notifier-context-menu-accounts-list-" + gGMailNotifier.defaultUser);
  if (currentItem) {
    currentItem.setAttribute("checked", false);
    currentItem.style.fontWeight = "";
  }

  currentItem = document.getElementById("gm-notifier-context-menu-accounts-list-" + name);

  if (currentItem) {
    currentItem.setAttribute("checked", true);
    currentItem.style.fontWeight = "bold";
  }

  // change default user
  gGMailNotifier.wm_prefs.setCharPref(this.wm_prefs.PREF_DEFAULT_USER, name);

  gGMailNotifier.mailModeChanged(name);
}

gm_notifier.prototype.loadAccountsWindow = function() {
  window.openDialog("chrome://gm-notifier/content/gm-accounts.xul", "gm-notifier:accounts", "centerscreen,chrome,resizable=no,dependent=yes");
}

gm_notifier.prototype.defaultUserChanged = function() {
  this.defaultUser = this.wm_prefs.getCharPref(this.wm_prefs.PREF_DEFAULT_USER);

  this.updateLabels();
}

gm_notifier.prototype.mailModeChanged = function(aUsername) {
  var value = gGMailNotifier.nsIGMNotifierService.getNewMailMode(aUsername);
  if (document.getElementById("gm-notifier-toolbar-item"))
    document.getElementById("gm-notifier-toolbar-item").setAttribute("new-mail", value ? "true" : "false");

  if (document.getElementById("gm-notifier-statusbar"))
    document.getElementById("gm-notifier-statusbar").setAttribute("new-mail", value ? "true" : "false");
}

gm_notifier.prototype.supportsMultiMode = function() {
  var supports = false;

  try {
    var appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
                            .getService(Components.interfaces.nsIXULAppInfo);
    if (appInfo.platformVersion >= "1.8.1")
      supports = true;
  } catch (e) {}

  return supports;
}

// startup
gm_notifier.prototype.onload = function() {
  // this is false if we are in ff's customize window
  if (document.getElementById("gm-notifier-statusbar")) {
    // add the listener on startup and init the xpcom class
    try {
      gGMailNotifier.nsIGMNotifierService = Components.classes["@mozilla.org/GMailNotifier;1"]
                                                  .getService(Components.interfaces.nsIGMNotifierService);
      gGMailNotifier.nsIGMNotifierProgressListener = new gGMailNotifier.NotifierProgressListener()
      gGMailNotifier.listenerID = gGMailNotifier.nsIGMNotifierService.addListener(gGMailNotifier.nsIGMNotifierProgressListener);
      gGMailNotifier.nsIGMNotifierProgressListener.id = gGMailNotifier.listenerID;

      document.getElementById("gm-notifier-statusbar").collapsed = !gGMailNotifier.wm_prefs.getBoolPref(gGMailNotifier.wm_prefs.PREF_STATUSBAR_ENABLED);

      // init multi-mode setup
      gGMailNotifier.toggleMultiAccountMode();
    } catch (e) {
      alert(e);
    }

    window.removeEventListener("load", gGMailNotifier.onload, false);
    gGMailNotifier.updateStatusBarPosition();
  }
}

// shutdown
gm_notifier.prototype.onunload = function() {
  if (document.getElementById("gm-notifier-statusbar")) {
    // cleanup time, but only if the statusbar item exists, due to toolkit's
    // customize window feature.

    // remove the listener
    if (gGMailNotifier.nsIGMNotifierService)
      gGMailNotifier.nsIGMNotifierService.removeListener(gGMailNotifier.nsIGMNotifierProgressListener);
  }

  // remove the pref observer
  if (gGMailNotifier.wm_prefs)
    gGMailNotifier.wm_prefs.removeObserver("gm-notifier", gGMailNotifier.PrefChangeObserver);

  // last, but not least, clear the whole object
  gGMailNotifier = null;
}

gm_notifier.prototype.initPopup = function() {
  document.getElementById("gm-context-menu-statusbar-item").setAttribute("checked", gGMailNotifier.wm_prefs.getBoolPref(gGMailNotifier.wm_prefs.PREF_STATUSBAR_ENABLED));

  // returning true will make the popup show
  return true;
}

var gGMailNotifier = new gm_notifier();

window.addEventListener("load", gGMailNotifier.onload, false);
window.addEventListener("unload", gGMailNotifier.onunload, false);
