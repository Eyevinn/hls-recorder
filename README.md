# hls-recorder

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Slack](http://slack.streamingtech.se/badge.svg)](http://slack.streamingtech.se)

Node library for recording HLS Live

## Installation

```
npm install --save @eyevinn/hls-recorder
```

## Usage (with Eyevinn Channel Engine)

```
const HLSRecorder = require("@eyevinn/hls-recorder");
const ChannelEngine = require("eyevinn-channel-engine");

/*
  For instructions on how to properly set up a channel engine, see:
  https://www.npmjs.com/package/eyevinn-channel-engine
*/

// First set up your channel engine instance
const assetMgr = new YourAssetManager();
const channelMgr = new YourChannelManager();

const engineOptions = {
  heartbeat: '/',
  channelManager: channelMgr
}

const engine = new ChannelEngine(assetMgr, engineOptions);

// Then use the instance as first input argument in HLSRecorder instance
const opts = {
  recordDuration: 4000 // seconds (-1 for infinite)
  windowSize: 3600 // seconds (-1 for infinite)
  vod: true // insert EXT-X-ENDLIST on end (creating a VOD)
};
const recorder = new HLSRecorder(engine, opts);

recorder.on("mseq-increment", mseq => {
  // Do stuff with media seq
});

recorder.listen(); // Have server listening on default port 8001

recorder.start(); // Start recording VOD2live stream

// View Recorder Stream Playback at: "http://localhost:8001/live/master.m3u8"
```

## Usage (with HLS Live Stream URL) - COMING SOON

```
const HLSRecorder = require("@eyevinn/hls-recorder");

const source = "https://true.live.stream/hls/master.m3u8"

const opts = {
  recordDuration: 4000 // seconds (-1 for infinite)
  windowSize: 3600 // seconds (-1 for infinite)
  vod: true // insert EXT-X-ENDLIST on end (creating a VOD)
};
const recorder = new HLSRecorder(source, opts);

recorder.on("mseq-increment", mseq => {
  // Do stuff with media seq
});

recorder.listen(); // Have server listening on default port 8001

recorder.start(); // Start recording live stream

// View Recorder Stream Playback at: "http://localhost:8001/live/master.m3u8"
```

# License (MIT)

Copyright 2021 Eyevinn Technology

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

# About Eyevinn Technology

Eyevinn Technology is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor.

At Eyevinn, every software developer consultant has a dedicated budget reserved for open source development and contribution to the open source community. This give us room for innovation, team building and personal competence development. And also gives us as a company a way to contribute back to the open source community.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!
