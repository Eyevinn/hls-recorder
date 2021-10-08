"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require(".");
const ChannelEngine = require("eyevinn-channel-engine");
const m3u8 = require("@eyevinn/m3u8");
const urlFetch = require("node-fetch");
const timer = (ms) => new Promise((res) => setTimeout(res, ms));
const VOD_URI = "https://playertest.longtailvideo.com/adaptive/elephants_dream_v4/index.m3u8"; //"https://nfrederiksen.github.io/testing-streams-hls/test-audio-birdsNgoats/playlist.m3u8";
class SDSAssetManager {
    constructor(opts) {
        // For Specs
        if (opts.mockAsset) {
            let mockJson = JSON.parse(opts.mockAsset);
            this.mockAssets = {
                "mock-1": [
                    {
                        id: mockJson.id,
                        title: mockJson.title,
                        uri: mockJson.uri,
                        timedMetadata: { "start-date": "2021-09-30T12:16:20.889Z" },
                    },
                ],
            };
        }
        this.assets = {
            "1": [
                {
                    id: "1",
                    title: "Input VOD",
                    uri: opts.vodUri,
                },
            ],
        };
        this.pos = {
            "1": 0,
        };
    }
    getNextVod(vodRequest) {
        return new Promise((resolve, reject) => {
            // For Specs
            if (this.mockAssets) {
                resolve(this.mockAssets["mock-1"][0]);
            }
            const channelId = vodRequest.playlistId;
            if (this.assets[channelId]) {
                let vod = this.assets[channelId][this.pos[channelId]++];
                if (this.pos[channelId] > this.assets[channelId].length - 1) {
                    this.pos[channelId] = 0;
                }
                vod.timedMetadata = {
                    "start-date": new Date().toISOString(),
                };
                resolve(vod);
            }
            else {
                reject("Invalid channelId provided");
            }
        });
    }
    handleError(err, vodResponse) {
        console.error(err.message, JSON.stringify(vodResponse, null, 2));
    }
}
class SDSChannelManager {
    constructor(opts) {
        let channel = {
            id: "1",
            profile: (opts === null || opts === void 0 ? void 0 : opts.videoProfiles) || this._getProfile,
            audioTracks: (opts === null || opts === void 0 ? void 0 : opts.audioProfiles) || this._getAudioTracks,
        };
        this.channels = [channel];
    }
    getChannels() {
        return this.channels;
    }
    _getProfile() {
        return [
            { bw: 6134000, codecs: "avc1.4d001f,mp4a.40.2", resolution: [1024, 458] },
            { bw: 2323000, codecs: "avc1.4d001f,mp4a.40.2", resolution: [640, 286] },
            { bw: 1313000, codecs: "avc1.4d001f,mp4a.40.2", resolution: [480, 214] },
        ];
    }
    _getAudioTracks() {
        return [{ language: "en", name: "English", default: true }];
    }
}
exports.default = SDSChannelManager;
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    const PROFILES = yield ParseProfilesFromMasterManifest(VOD_URI);
    //console.log("Found Vod Profiles", JSON.stringify(PROFILES, null, 2));
    const channelManager = new SDSChannelManager({
        videoProfiles: PROFILES.video,
        audioProfiles: PROFILES.audio,
    });
    const assetManager = new SDSAssetManager({ vodUri: VOD_URI });
    const engineOptions = {
        heartbeat: "/",
        channelManager: channelManager,
        //useDemuxedAudio: true,
        //cloudWatchMetrics: true
    };
    console.log(engineOptions);
    const engine = new ChannelEngine(assetManager, engineOptions);
    engine.start();
    engine.listen(8000);
    yield timer(3000);
    const recorder = new _1.HLSRecorder(engine, { windowSize: 120, vod: true });
    console.log("[test-server.js]: Starting HLSRecorder...");
    recorder
        .start()
        .then((msg) => console.log("[test-server.js]: ...we done:", msg))
        .catch((err) => console.log(err));
    recorder.on("mseq-increment", (mseq) => {
        console.log("[test-server.js]: recorder.on('mseq-increment') triggered! The mseq became:" +
            JSON.stringify(mseq));
    });
});
// Run the Servers---
run();
//-------------------
// Helper Function
function ParseProfilesFromMasterManifest(masterURI) {
    let VOD_PROFILES = {
        video: [],
        audio: [],
    };
    return new Promise((resolve, reject) => {
        //console.log("Starting HLS parsing job on:", masterURI);
        const parser = m3u8.createStream();
        parser.on("m3u", (m3u) => {
            let targetAudioGroupID = "";
            // Get all Video profiles from Master Manifest
            for (let i = 0; i < m3u.items.StreamItem.length; i++) {
                let newProfile = {
                    bw: 0,
                    codecs: "",
                    resolution: [],
                };
                const streamItem = m3u.items.StreamItem[i];
                if (streamItem.get("bandwidth")) {
                    newProfile.bw = streamItem.get("bandwidth");
                    if (streamItem.get("resolution")) {
                        newProfile.resolution = [
                            streamItem.get("resolution")[0],
                            streamItem.get("resolution")[1],
                        ];
                    }
                    if (streamItem.get("codecs")) {
                        newProfile.codecs = streamItem.get("codecs");
                    }
                    VOD_PROFILES.video.push(newProfile);
                    // Find what audio GROUP-ID stream variants are equiped with.
                    if (streamItem.attributes.attributes["audio"]) {
                        targetAudioGroupID = streamItem.attributes.attributes["audio"];
                    }
                }
            }
            // Get all Audio profiles from Master Manifest
            let audioGroupItems = m3u.items.MediaItem.filter((item) => {
                return (item.attributes.attributes.type === "AUDIO" &&
                    item.attributes.attributes["group-id"] === targetAudioGroupID);
            });
            // Extract every audio mediaitem's relevant attributes
            audioGroupItems.map((audioItem) => {
                let newAudioProfile = {
                    language: "",
                    name: "",
                };
                if (audioItem.attributes.attributes["language"]) {
                    newAudioProfile.language =
                        audioItem.attributes.attributes["language"];
                }
                if (audioItem.attributes.attributes["name"]) {
                    newAudioProfile.name = audioItem.attributes.attributes["name"];
                }
                VOD_PROFILES["audio"].push(newAudioProfile);
            });
            resolve(VOD_PROFILES);
        });
        parser.on("error", (exc) => {
            console.error(`Parser Error: ${JSON.stringify(exc)}`);
            reject(exc);
        });
        urlFetch(masterURI)
            .then((res) => {
            res.body.pipe(parser);
        })
            .catch(reject);
    });
}
//# sourceMappingURL=test-server.js.map