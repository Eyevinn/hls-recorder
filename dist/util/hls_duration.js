"use strict";
const m3u8 = require('@eyevinn/m3u8');
const fetch = require('node-fetch');
const url = require('url');
const calcDuration = mediaManifestUrl => new Promise((resolve, reject) => {
    const parser = m3u8.createStream();
    parser.on('m3u', m3u => {
        let duration = 0;
        for (let i = 0; i < m3u.items.PlaylistItem.length; i++) {
            duration += m3u.items.PlaylistItem[i].get('duration');
        }
        resolve(duration);
    });
    fetch(mediaManifestUrl)
        .then(res => {
        res.body.pipe(parser);
    })
        .catch(reject);
});
module.exports = uri => new Promise((resolve, reject) => {
    const parser = m3u8.createStream();
    parser.on('m3u', m3u => {
        const streamItem = m3u.items.StreamItem[0];
        let baseUrl;
        const m = uri.match(/^(.*)\/.*?$/);
        if (m) {
            baseUrl = m[1] + '/';
        }
        const mediaManifestUrl = url.resolve(baseUrl, streamItem.get('uri'));
        calcDuration(mediaManifestUrl).then(duration => {
            resolve(duration);
        });
    });
    fetch(uri)
        .then(res => {
        res.body.pipe(parser);
    })
        .catch(reject);
});
//# sourceMappingURL=hls_duration.js.map