// Uninstall ******* 
// big HACK
function gm_notifier_uninstall(){
  var confirmUninstall = confirm("The notifier will be uninstalled after Mozilla is restarted. \n\nDo you want to uninstall?");
  
  if (!confirmUninstall) // user choose to cancel
    return;

  // remove the UI
  
  //remove the overlay entry in overlays.rdf

  var CONTAINER_NAME  = "chrome://navigator/content/navigator.xul";
  var NODE_NAME       = "chrome://gm-notifier/content/gm-sm-overlay.xul";

  var dirServ = Components.classes['@mozilla.org/file/directory_service;1'].createInstance();
  dirServ = dirServ.QueryInterface(Components.interfaces.nsIProperties);
  var processDir = dirServ.get("ProfD", Components.interfaces.nsIFile);
  processDir.append("chrome");
  processDir.append("overlayinfo");
  processDir.append("navigator");
  processDir.append("content");
  processDir.append("overlays.rdf");

  removeRDFContainer(processDir, CONTAINER_NAME, NODE_NAME);

  // remove chrome.rdf entries

  CONTAINER_NAME = 'urn:mozilla:package:root';
  NODE_NAME = 'urn:mozilla:package:gm-notifier';
  processDir = dirServ.get("ProfD", Components.interfaces.nsIFile);
  processDir.append("chrome");
  processDir.append("chrome.rdf");

  removeRDFContainer(processDir, CONTAINER_NAME, NODE_NAME);

  // remove the installed-chrome.txt entries - thanks to HJ for the code
  /*
  processDir = dirServ.get("ProfD", Components.interfaces.nsIFile);
  processDir.append("chrome");
  processDir.append("installed-chrome.txt");
  
  var entries = ReadFrom(processDir);
  entries = entries.replace(new RegExp('[^\\n\\r]+'+"resource:/chrome/gm-notifier.jar!/content/"+'[\\n\\r]+', 'g'), '');
  WriteTo(processDir, entries); 
  */
  function removeRDFContainer(fileRef, containerName, nodeName){
    var C                       = Components;
    const RDF_SRVC_PROG_ID      = '@mozilla.org/rdf/rdf-service;1';
    const RDF_CONTAINER_PROG_ID = '@mozilla.org/rdf/container;1';
    const RDF_DS_PROG_ID        = '@mozilla.org/rdf/datasource;1?name=xml-datasource';
        
    if (!fileRef.exists()) {
        return;
    }
 
    var ioService = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);

    var myFileUrl = null;
    
    // Interface change - ns7 (mozilla 1.0) needs nsIIOService, later (mozilla 1.2) needs nsIFileProtocolHandler
    if(Components.interfaces.nsIFileProtocolHandler){
      var fileHandler = ioService.getProtocolHandler("file").QueryInterface(Components.interfaces.nsIFileProtocolHandler);  
      myFileUrl = fileHandler.getURLSpecFromFile(fileRef);
    } else {
      myFileUrl = ioService.getURLSpecFromFile(fileRef);    
    }  
  
    try {
      var rdf   = C.classes
                  [RDF_SRVC_PROG_ID].getService(C.interfaces.nsIRDFService);

      var ds    = rdf.GetDataSource(myFileUrl);
  
      var rem   = ds.QueryInterface(C.interfaces.nsIRDFRemoteDataSource);
      if (!rem.loaded) {
        rdf.UnregisterDataSource(ds);
        ds        = C.classes[RDF_DS_PROG_ID].
                    getService(C.interfaces.nsIRDFDataSource);
        rem       = ds.QueryInterface(C.interfaces.nsIRDFRemoteDataSource);
        rem.Init(myFileUrl);
      }
      rem.Refresh(true)
      var rs  = rdf.GetResource(containerName);
      var container = C.classes[RDF_CONTAINER_PROG_ID].
                           getService(C.interfaces.nsIRDFContainer);
      container.Init(rem, rs);

      var el = rdf.GetLiteral(nodeName); // remove if it's a literal
      container.RemoveElement(el, true);
      el = rdf.GetResource(nodeName); // remove it it's a resource
      container.RemoveElement(el, true);
      rem.Flush()
      rem.Refresh(true)
    } catch (e) {
      return;
    }
  }
  
  function ReadFrom(aFile) 
	{
		var stream = Components.classes['@mozilla.org/network/file-input-stream;1'].createInstance(Components.interfaces.nsIFileInputStream);
		stream.init(aFile, 1, 0, false); // open as "read only"

		var scriptableStream = Components.classes['@mozilla.org/scriptableinputstream;1'].createInstance(Components.interfaces.nsIScriptableInputStream);
		scriptableStream.init(stream);

		var fileSize = scriptableStream.available();
		var fileContents = scriptableStream.read(fileSize);

		scriptableStream.close();
		stream.close();

		return fileContents;
  }
  function WriteTo(aFile, aContent) 
	{
		if (aFile.exists()) aFile.remove(true);
		aFile.create(aFile.NORMAL_FILE_TYPE, 0666);

		var stream = Components.classes['@mozilla.org/network/file-output-stream;1'].createInstance(Components.interfaces.nsIFileOutputStream);
		stream.init(aFile, 2, 0x200, false); // open as "write only"

		stream.write(aContent, aContent.length);

		stream.close();
	}  
}

