# hls-recorder

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Slack](http://slack.streamingtech.se/badge.svg)](http://slack.streamingtech.se)

Node library for recording HLS Live

## Installation

```
npm install --save @eyevinn/hls-recorder
```

## Usage (with Eyevinn Channel Engine)

```javascript
const { HLSRecorder } = require("@eyevinn/hls-recorder");
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
  recordDuration: 4000, // seconds (-1 for infinite)
  windowSize: 240000, // seconds | -1 for infinite* (will fallback to Default if source is not EVENT or VOD type) | Default = 300000
  vod: true // insert EXT-X-ENDLIST on end (creating a VOD)
};
const recorder = new HLSRecorder(engine, opts);

recorder.on("mseq-increment", mseq => {
  // Do stuff with media seq
});

recorder.start(); // Start recording VOD2live stream

/** 
 * The recording can also be played back, in the form of an event Hls stream.
 *  If you want to view the recorded stream locally, then use the follwoing lines: 
 **/
const restify = require('restify')
recorder.setRestifyServer(restify); // Create a Restify server instance in recorder
recorder.listen(); // Have server listening on default port 8001

// View Recorder Stream Playback at: "http://localhost:8001/live/master.m3u8"
```

## Usage (with HLS Live Stream URL)

```javascript
const { HLSRecorder } = require("@eyevinn/hls-recorder");

const source = "https://true.live.stream/hls/master.m3u8"

const opts = {
  recordDuration: 4000, // seconds | -1 for infinite | Default = -1
  windowSize: 240000, // seconds | -1 for infinite* (will fallback to Default if source is not EVENT or VOD type) | Default = 300000
  vod: true // insert EXT-X-ENDLIST on end (creating a VOD)
const recorder = new HLSRecorder(source, opts);

recorder.on("mseq-increment", mseq => {
  // Do stuff with media seq
});

recorder.start(); // Start recording live stream

/** 
 * The recording can also be played back, in the form of an event Hls stream.
 *  If you want to view the recorded stream locally, then use the follwoing lines: 
 **/
const restify = require('restify')
recorder.setRestifyServer(restify); // Create a Restify server instance in recorder
recorder.listen(); // Have server listening on default port 8001

// View Recorder Stream Playback at: "http://localhost:8001/live/master.m3u8"
```
## Stopping
To stop the recorder use:
```javascript
recorder.stop()
```
This will close the server, if listening, and will add an ENDLIST tag to the bottom of each playlist manifest


# About Eyevinn Technology

Eyevinn Technology is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor.

At Eyevinn, every software developer consultant has a dedicated budget reserved for open source development and contribution to the open source community. This give us room for innovation, team building and personal competence development. And also gives us as a company a way to contribute back to the open source community.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!
