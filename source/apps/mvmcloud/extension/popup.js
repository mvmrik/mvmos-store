// mvmCloud needs no browser privilege: the shared extension shell simply
// hosts its public file manager, with login remaining on the server origin.
(function(){ if(globalThis.mvmExt) mvmExt.onFrameReady(function(){}); })();
