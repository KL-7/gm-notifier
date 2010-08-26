const kPSWDMANAGER_CONTRACTID = "@mozilla.org/passwordmanager;1";
const nsIPasswordManager = Components.interfaces.nsIPasswordManager;

var gPasswordArray = new Array();

function onLoad() {
  document.getElementById("status").value = getLocalizedString("LoggingStatusLoggedOut");

  var url = "chrome://gm-notifier/";

  if (Components.classes["@mozilla.org/login-manager;1"]) {
    var passwordManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);

    var passwords = passwordManager.findLogins({}, url, null, "gm-notifier");
    if (passwords.length > 0) {
      for (var i = 0; i < passwords.length; i++) {
        user = passwords[i].username;
        password = passwords[i].password;

        // XXX: why not call the service here to get password?
        if (password === " ") {
          // XXX: empty password is " " for now due to ff3 change
          password = "";
        }

        gPasswordArray[user] = password;

        document.getElementById("username").appendItem(user, user);
      }
    }
  } else {
    var passwordManager = Components.classes[kPSWDMANAGER_CONTRACTID]
                          .createInstance(nsIPasswordManager);

    var enumerator = passwordManager.enumerator;

    var user, password;

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
          user = nextPassword.user;
          password = nextPassword.password;

          gPasswordArray[user] = password;

          document.getElementById("username").appendItem(user, user);

        } catch (e) {
          continue;
        }
      }
    }
  }

  var username = window.opener.gGMailNotifier.wm_prefs.getCharPref("gm-notifier.users.default");

  if (username) {
    document.getElementById("username").value = username;
    document.getElementById("password").value = window.opener.gGMailNotifier.getLoginDetails(username);
    document.getElementById("store-password").checked =
      window.opener.gGMailNotifier.wm_prefs.getBoolPref("gm-notifier.users.remember-password");
	if (!document.getElementById("password").value) {
	  document.getElementById("password").focus()
	}
  }
}

function selectionChanged(aElement) {
  var name = aElement.value;

  if (gPasswordArray[name] != null) {
    document.getElementById("password").value = gPasswordArray[name];
  }
}

function getLocalizedString(aName) {
  var strbundle=document.getElementById("strings");
  return strbundle.getString(aName);
}

function onAccept() {
  window.opener.gGMailNotifier.initLogin(
    document.getElementById("username").value, 
    document.getElementById("password").value);

  // remember login pref
  window.opener.gGMailNotifier.wm_prefs.setBoolPref("gm-notifier.users.remember-password",
    document.getElementById("store-password").checked);

  return false;
}

function setStatus(aStatusNum) {
  var statusMsg = "";

  switch (aStatusNum){
    // trying to log in
    case 1:
      document.getElementById("login").disabled = true;
      statusMsg = getLocalizedString("LoggingStatusLoggingIn");
      break;

    // logged in
    case 2:
      statusMsg = getLocalizedString("LoggingStatusLoggedIn");

      window.opener.gGMailNotifier.storeLoginDetails(document.getElementById("store-password").checked);

      // clear reference to self
      window.opener.gGMailNotifier.login_window = null;

      setTimeout("window.close()", 1000)
      break;

    // failed to login
    case 3:
      statusMsg = getLocalizedString("LoggingStatusFailed1");
      document.getElementById("login").disabled = false;
      break;

    // invalid username/password
    case 4:
      statusMsg = getLocalizedString("LoggingStatusInvalidLogin");
      document.getElementById("login").disabled = false;
      break;

    default:
      statusMsg = getLocalizedString("LoggingStatusError");
      break
  }

  document.getElementById("status").value = statusMsg;
}

