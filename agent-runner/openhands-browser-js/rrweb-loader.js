(function() {
    if (window.__rrweb_loaded) return;
    window.__rrweb_loaded = true;

    window.__rrweb_events = window.__rrweb_events || [];
    window.__rrweb_should_record = window.__rrweb_should_record || false;
    window.__rrweb_load_failed = false;

    var resolveReady;
    window.__rrweb_ready_promise = new Promise(function(resolve) {
        resolveReady = resolve;
    });

    function loadRrweb() {
        var s = document.createElement('script');
        s.src = '{{CDN_URL}}';
        s.onload = function() {
            window.__rrweb_ready = true;
            console.log('[rrweb] Loaded successfully from CDN');
            resolveReady({success: true});
            if (window.__rrweb_should_record && !window.__rrweb_stopFn) {
                window.startRecordingInternal();
            }
        };
        s.onerror = function() {
            console.error('[rrweb] Failed to load from CDN');
            window.__rrweb_load_failed = true;
            resolveReady({success: false, error: 'load_failed'});
        };
        (document.head || document.documentElement).appendChild(s);
    }

    window.startRecordingInternal = function() {
        var recordFn = (typeof rrweb !== 'undefined' && rrweb.record) ||
                       (typeof rrwebRecord !== 'undefined' && rrwebRecord.record);
        if (!recordFn || window.__rrweb_stopFn) return;

        window.__rrweb_events = [];
        window.__rrweb_stopFn = recordFn({
            emit: function(event) {
                window.__rrweb_events.push(event);
            }
        });
        console.log('[rrweb] Auto-started recording on new page');
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadRrweb);
    } else {
        loadRrweb();
    }
})();
