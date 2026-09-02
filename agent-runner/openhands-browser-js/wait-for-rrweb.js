(function() {
    if (!window.__rrweb_ready_promise) {
        return Promise.resolve({success: false, error: 'not_injected'});
    }
    if (window.__rrweb_ready) {
        return Promise.resolve({success: true});
    }
    if (window.__rrweb_load_failed) {
        return Promise.resolve({success: false, error: 'load_failed'});
    }
    return window.__rrweb_ready_promise;
})();
