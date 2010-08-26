const kGMSERVICE_CONTRACTID = "@mozilla.org/GMailNotifierProgressListener;1"
const kGMSERVICE_CID = Components.ID("67d3a9ce-c2f5-48bb-a9f7-c37a61264ecd");
const nsISupports = Components.interfaces.nsISupports;

function nsGMNotifierProgressListener()
{
}

nsGMNotifierProgressListener.prototype.onStateChange = function(aUsername, aState) {
}

nsGMNotifierProgressListener.prototype.QueryInterface = function(iid) {
  if (!iid.equals(Components.interfaces.nsIGMNotifierProgressListener) &&
      !iid.equals(Components.interfaces.nsIGMNotifierService) &&
      !iid.equals(nsISupports)) {
    throw Components.results.NS_ERROR_NO_INTERFACE;
  }

  return this;
}

/**
 * JS XPCOM component registration goop:
 *
 * We set ourselves up to observe the xpcom-startup category.  This provides
 * us with a starting point.
 */

var nsGMNotifierProgressListenerModule = new Object();

nsGMNotifierProgressListenerModule.registerSelf =
function (compMgr, fileSpec, location, type)
{
  compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
  compMgr.registerFactoryLocation(kGMSERVICE_CID,
                                  "nsGMNotifierProgressListener",
                                  kGMSERVICE_CONTRACTID,
                                  fileSpec, 
                                  location, 
                                  type);
}

nsGMNotifierProgressListenerModule.getClassObject =
function (compMgr, cid, iid)
{
  if (!cid.equals(kGMSERVICE_CID)) {
    throw Components.results.NS_ERROR_NO_INTERFACE;
  }

  if (!iid.equals(Components.interfaces.nsIFactory)) {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  }

  return nsGMNotifierProgressListenerFactory;
}

nsGMNotifierProgressListenerModule.canUnload =
function (compMgr)
{
  return true;
}

var nsGMNotifierProgressListenerFactory = new Object();

nsGMNotifierProgressListenerFactory.createInstance =
function (outer, iid)
{
  if (outer != null) {
    throw Components.results.NS_ERROR_NO_AGGREGATION;
  }

  if (!iid.equals(Components.interfaces.nsIGMNotifierProgressListener) &&
      !iid.equals(nsISupports)) {
    throw Components.results.NS_ERROR_NO_INTERFACE;
  }

  return new nsGMNotifierProgressListener();
}

function NSGetModule(compMgr, fileSpec)
{
  return nsGMNotifierProgressListenerModule;
}
