function gm_prefs() {
  this.prefBranch = null;

  // pref values
  this.PREF_STATUSBAR_ENABLED     = "gm-notifier.sidebar.enabled"; // oops, sidebar?
  this.PREF_UPDATE_INTERVAL       = "gm-notifier.update.interval";
  this.PREF_LOAD_LOCATION         = "gm-notifier.loadgm.location";
  this.PREF_LOAD_RESET_COUNTER    = "gm-notifier.loadgm.reset_counter";
  this.PREF_AUTOLOGIN_ENABLED     = "gm-notifier.autologin.enabled";
  this.PREF_NOTIFICATIONS_ENABLED = "gm-notifier.ui.notification.enabled";
  this.PREF_SOUNDNOTIFICATIONS_ENABLED = "gm-notifier.ui.soundnotification.enabled";
  this.PREF_SOUNDNOTIFICATIONS_URI = "gm-notifier.ui.soundnotification.uri";
  this.PREF_DEFAULT_USER          = "gm-notifier.users.default";
  this.PREF_REMEMBER_PASSWORD     = "gm-notifier.users.remember-password";
  this.PREF_IS_LOGGED_IN          = "gm-notifier.loggedin";
  this.PREF_USE_FOLDERVIEW        = "gm-notifier.ui.folderview";
  this.PREF_COUNTER_SHOW_INBOX    = "gm-notifier.ui.counter.showInbox";
  this.PREF_STATUSBAR_POSITION    = "gm-notifier.ui.statusbar.position";
  this.PREF_UNSECURED_CONNECTION  = "gm-notifier.connection.use.unsecured";
  this.PREF_MULTIACCOUNT_ENABLED  = "gm-notifier.multiaccount.enabled";
  this.PREF_NOTIFICATIONS_REPEAT  = "gm-notifier.notification.repeat";

  // "hidden" prefs
  this.PREF_DISABLE_TAB_REUSE = "gm-notifier.tabreuse.disable";
  this.PREF_USE_GMAIL_1_0 = "gm-notifier.loadgm.oldgmail";
}

gm_prefs.prototype.getPrefBranch = function() {
  if (!this.prefBranch){ 
    this.prefBranch = Components.classes['@mozilla.org/preferences-service;1'].getService();
    this.prefBranch = this.prefBranch.QueryInterface(Components.interfaces.nsIPrefBranch);
  }

  return this.prefBranch;
}

gm_prefs.prototype.setBoolPref = function(aName, aValue) {
  try {
    this.getPrefBranch().setBoolPref(aName, aValue);
  } catch (e) {}
}

gm_prefs.prototype.getBoolPref = function(aName) {
  var rv = null;

  try {
    rv = this.getPrefBranch().getBoolPref(aName);
  } catch (e) {}

  return rv;
}

gm_prefs.prototype.setIntPref = function(aName, aValue) {
  try {
    this.getPrefBranch().setIntPref(aName, aValue);
  } catch (e) {}
}

gm_prefs.prototype.getIntPref = function(aName) {
  var rv = null;

  try {
    rv = this.getPrefBranch().getIntPref(aName);
  } catch (e){
  }

  return rv;
}

gm_prefs.prototype.setCharPref = function(aName, aValue) {
  this.getPrefBranch().setCharPref(aName, aValue);
}

gm_prefs.prototype.getCharPref = function(aName) {
  var rv = null;

  try {
    rv = this.getPrefBranch().getCharPref(aName);
  } catch (e){

  }

  return rv;
}

gm_prefs.prototype.addObserver = function(aDomain, aFunction) {
  var myPrefs = this.getPrefBranch();
  var prefBranchInternal = myPrefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);

  if (prefBranchInternal)
    prefBranchInternal.addObserver(aDomain, aFunction, false);
}

gm_prefs.prototype.removeObserver = function(aDomain, aFunction) {
  var myPrefs = this.getPrefBranch();
  var prefBranchInternal = myPrefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);

  if (prefBranchInternal)
    prefBranchInternal.removeObserver(aDomain, aFunction);
}

gm_prefs.prototype.initPrefs = function() {
  // migrate preferences
  var arePrefsUpToDate = this.getBoolPref(this.PREF_NOTIFICATIONS_REPEAT);
  if (arePrefsUpToDate == null) {
    // set prefs if they don't exit
    this.initPref(this.PREF_STATUSBAR_ENABLED , "bool", true);
    this.initPref(this.PREF_UPDATE_INTERVAL, "int", 10);
    this.initPref(this.PREF_DEFAULT_USER, "char", "");
    this.initPref(this.PREF_REMEMBER_PASSWORD, "bool", false);
    this.initPref(this.PREF_LOAD_LOCATION, "int", 0);
    this.initPref(this.PREF_LOAD_RESET_COUNTER, "bool", false);
    this.initPref(this.PREF_AUTOLOGIN_ENABLED, "bool", false);
    this.initPref(this.PREF_IS_LOGGED_IN, "bool", false);
    this.initPref(this.PREF_NOTIFICATIONS_ENABLED, "bool", true);
    this.initPref(this.PREF_SOUNDNOTIFICATIONS_ENABLED, "bool", false);
    this.initPref(this.PREF_DEBUG_CONSOLE_ENABLED, "bool", false);
    this.initPref(this.PREF_USE_FOLDERVIEW, "bool", false);
    this.initPref(this.PREF_COUNTER_SHOW_INBOX, "bool", true);
    this.initPref(this.PREF_STATUSBAR_POSITION, "int", 0);
    this.initPref(this.PREF_UNSECURED_CONNECTION, "bool", false);
    this.initPref(this.PREF_MULTIACCOUNT_ENABLED, "bool", false);
    this.initPref(this.PREF_NOTIFICATIONS_REPEAT, "bool", false);
  }
}

gm_prefs.prototype.initAccounts = function() {
  var areAccountsMigrated = this.getBoolPref("gm-notifier.userlistmigrated");
  // XXX: remove
  dump("\n are accounts migrated: " + (areAccountsMigrated == null ? "no" : "yes")+"\n");
  if (areAccountsMigrated == null) {
    var host = "chrome://gm-notifier/";
    var pm = Components.classes["@mozilla.org/passwordmanager;1"]
                        .createInstance(Components.interfaces.nsIPasswordManager);
    // we create a pref list from the stores passwords list
    // gm-notifier.userlist.[username].{autologin, isloggedin}
    var enumerator = pm.enumerator;
    var user, password;

    while (enumerator.hasMoreElements()) {
      var nextPassword;
      try {
        nextPassword = enumerator.getNext();
      } catch(e) {
        break;
      }
      nextPassword = nextPassword.QueryInterface(Components.interfaces.nsIPassword);
      var nextHost = nextPassword.host;

      if (nextHost == host) {
        // try/catch in case decryption fails (invalid signon entry)
        try {
          user = nextPassword.user;
          password = nextPassword.password;
          this.setBoolPref("gm-notifier.userlist." + user + ".autologin", false);
          this.setBoolPref("gm-notifier.userlist." + user + ".loggedin", false);
        } catch (e) {
          continue;
        }
      }
    }

    // we migrated!
    this.setBoolPref("gm-notifier.userlistmigrated", true);
  }
}

gm_prefs.prototype.initPref = function(aPrefName, aPrefType, aDefaultValue) {
  switch (aPrefType) {
    case "bool" :
      var prefExists = this.getBoolPref(aPrefName);
      if (prefExists == null)
        this.setBoolPref(aPrefName, aDefaultValue);
      break;

    case "int" :
      var prefExists = this.getIntPref(aPrefName);
      if (prefExists == null)
        this.setIntPref(aPrefName, aDefaultValue);
      break;

    case "char" :
      var prefExists = this.getCharPref(aPrefName);
      if (prefExists == null)
        this.setCharPref(aPrefName, aDefaultValue);
      break;
  }
}

gm_prefs.prototype.clearPref = function(aPrefName) {
  var rv = null;

  try{
    rv = this.getPrefBranch().clearUserPref(aPrefName);
  } catch (e) {
  }

  return rv;
}
