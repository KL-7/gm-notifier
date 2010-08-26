// User defined constants

const myProductName = "gm-notifier";
const myProductRegKey = "/gm-notifier";
const myProductRegVersion = "0.6.4.2";
const myJarFileName = "gm-notifier.jar";

// Installation Script - no user modifications needed

// OS type detection
// which platform?
function getPlatform()
{
  var platformStr;
  var platformNode;

  if('platform' in Install)
  {
    platformStr = new String(Install.platform);

    if (!platformStr.search(/^Macintosh/))
      platformNode = 'mac';
    else if (!platformStr.search(/^Win/))
      platformNode = 'win';
    else if (!platformStr.search(/^OS\/2/))
      platformNode = 'win';
    else
      platformNode = 'unix';
  }
  else
  {
    var fOSMac  = getFolder("Mac System");
    var fOSWin  = getFolder("Win System");

    //logComment("fOSMac: "  + fOSMac);
    //logComment("fOSWin: "  + fOSWin);

    if(fOSMac != null)
      platformNode = 'mac';
    else if(fOSWin != null)
      platformNode = 'win';
    else
      platformNode = 'unix';
  }

  return platformNode;
}

var err = initInstall(myProductName, myProductRegKey, myProductRegVersion);
logComment("initInstall: " + err);

//fChrome = getFolder("Chrome");

fChrome = getFolder("Program");
setPackageFolder(fChrome);
err = addFile(".autoreg");
logComment("addFile() for .autoreg returned: " + err);

fChrome = getFolder("Program", "components");
setPackageFolder(fChrome);
err = addFile("components/nsGMNotifierProgressListener.js");
err = addFile("components/nsIGMNotifierProgressListener.xpt");
err = addFile("components/nsGMNotifierService.js");
err = addFile("components/nsIGMNotifierService.xpt");
logComment("addFile() for components returned: " + err);

fChrome = getFolder("Profile", "chrome");
setPackageFolder(fChrome);
err = addFile("chrome/"+myJarFileName);
logComment("addFile() for jar file returned: " + err);

logComment("Url is: " + getFolder(fChrome,myJarFileName) + "/content/");

regErr = registerChrome(PACKAGE | PROFILE_CHROME, getFolder(fChrome,myJarFileName), "content/gm-notifier/");
logComment("regChrome (package) returned: " + regErr);

regErr = registerChrome(LOCALE | PROFILE_CHROME, getFolder(fChrome,myJarFileName), "locale/en-US/gm-notifier/"); 
logComment("regChrome (locale) returned: " + regErr);

var locales = ["bg-BG", "ca-AD", "cs-CZ", "da-DK", "es-AR", "es-ES", "fi-FI", "fr-FR", "he-IL", "hu-HU", "id-ID", "it-IT", "ja-JP", "nb-NO", "nl-NL", "pl-PL", "pt-BR", "pt-PT", "ru-RU", "sv-SE", "sk-SK", "zh-CN", "zh-TW"];

for (locale in locales) {
  regErr = registerChrome(LOCALE | PROFILE_CHROME, getFolder(fChrome,myJarFileName), "locale/"+locales[locale]+"/gm-notifier/"); 
  logComment("regChrome (locale - "+locales[locale]+") returned: " + regErr);
}

if ((getLastError() == 0) || (getLastError() == -202))
  performInstall();
else
  cancelInstall(err);
