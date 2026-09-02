(function() {
    var events = window.__rrweb_events || [];
    window.__rrweb_events = [];
    return JSON.stringify({events: events});
})();
