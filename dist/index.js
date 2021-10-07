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
exports.HLSRecorder = void 0;
const EventEmitter = require("events").EventEmitter;
const m3u8 = require("@eyevinn/m3u8");
const str2stream = require("string-to-stream");
const debug = require("debug")("recorder");
const timer = (ms) => new Promise((res) => setTimeout(res, ms));
/*
         ___
       [|   |=|{)__
        |___| \/   )
HLS      /|\      /|
Recorder/ | \     | \
*/
class HLSRecorder extends EventEmitter {
    constructor(source, opts) {
        super();
        this.windowSize = opts.windowSize ? opts.windowSize : -1;
        this.vod = opts.vod ? opts.vod : false;
        if (typeof source === "string") {
            if (source.match(/master.m3u8/)) {
                this.liveMasterUri = source;
            }
            else {
                throw new Error("Invalid source URI!");
            }
        }
        else {
            // Assume user sends a channel-engine instance as input arg
            this.engine = source;
        }
        this.recorderMediaSeq = 0;
        this.playheadState = 0 /* IDLE */;
        this.masterManifest = "";
        this.mediaManifests = {};
        this.audioManifests = {};
        this.segments = {
            video: {},
            audio: {},
        };
    }
    // Public Functions
    start() {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._loadAllManifest();
                //console.log(JSON.stringify(this.segments, null, 2));
                yield timer(6000);
                yield this._loadAllManifest();
                //console.log(JSON.stringify(this.segments, null, 2));
                resolve("Success");
            }
            catch (err) {
                reject("Something went Wrong!");
            }
        }));
    }
    startPlayheadAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            debug(`[]: SessionLive-Playhead consumer started`);
            this.playheadState = 1 /* RUNNING */;
            while (this.playheadState !== 3 /* CRASHED */) {
                try {
                    // Nothing to do if we have no Live Source to probe
                    if (!this.masterManifest) {
                        yield timer(3000);
                        continue;
                    }
                    // Let the playhead move at an interval set according to live segment duration
                    let segmentDurationMs = 6000;
                    let videoBws = Object.keys(this.segments["video"]);
                    if (!videoBws.length &&
                        !this.segments["video"][videoBws[0]].segList.length &&
                        this.segments["video"][videoBws[0]].segList[0].duration) {
                        segmentDurationMs =
                            this.segments["video"][videoBws[0]].segList[0].duration * 1000;
                    }
                    // Fetch Live-Source Segments, and get ready for on-the-fly manifest generation
                    // And also compensate for processing time
                    const tsIncrementBegin = Date.now();
                    yield this._loadAllManifests();
                    const tsIncrementEnd = Date.now();
                    // Set the timer
                    let tickInterval = 0;
                    tickInterval = segmentDurationMs - (tsIncrementEnd - tsIncrementBegin);
                    tickInterval = tickInterval < 2 ? 2 : tickInterval;
                    debug(`[]: SessionLive-Playhead going to ping again after ${tickInterval}ms`);
                    yield timer(tickInterval);
                }
                catch (err) {
                    debug(`[]: SessionLive-Playhead consumer crashed`);
                    debug(err);
                    this.playheadState = 3 /* CRASHED */;
                }
            }
        });
    }
    // Private functions
    //----------------------------------------
    // TODO: Parse and Store from live URI
    //----------------------------------------
    _loadAllManifest() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.engine) {
                    yield this._getEngineManifests();
                }
                else {
                    yield this._getLiveManifests();
                }
                yield this._loadM3u8Segments();
                let firstMseq = this.segments["video"][Object.keys(this.segments["video"])[0]].mediaSeq;
                if (firstMseq > this.recorderMediaSeq) {
                    this.recorderMediaSeq = firstMseq;
                    this.emit("mseq-increment", { mseq: this.recorderMediaSeq });
                }
            }
            catch (err) {
                console.log("HELLO..");
                return Promise.reject(err);
            }
        });
    }
    _getLiveManifests() {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: . . . use node-fetch
        });
    }
    _getEngineManifests() {
        return __awaiter(this, void 0, void 0, function* () {
            const channelId = "1";
            try {
                if (this.masterManifest === "") {
                    this.masterManifest = yield this.engine.getMasterManifest(channelId);
                }
                this.mediaManifests = yield this.engine.getMediaManifests(channelId);
                this.audioManifests = yield this.engine.getAudioManifests(channelId);
            }
            catch (err) {
                console.error("Error: Issue retrieving manifests from engine!", err);
            }
        });
    }
    _loadM3u8Segments() {
        return __awaiter(this, void 0, void 0, function* () {
            let loadMediaPromises = [];
            let loadAudioPromises = [];
            // For each bandwidth...
            const bandwidths = Object.keys(this.mediaManifests);
            bandwidths.forEach((bw) => {
                loadMediaPromises.push(this._loadMediaSegments(parseInt(bw)));
            });
            // For each group...
            const audioGroups = Object.keys(this.audioManifests);
            audioGroups.forEach((group) => {
                const audioLangs = Object.keys(this.audioManifests[group]);
                // For each language track...
                for (let i = 0; i < audioLangs.length; i++) {
                    const lang = audioLangs[i];
                    loadAudioPromises.push(this._loadAudioSegments(group, lang));
                }
            });
            yield Promise.all(loadMediaPromises.concat(loadAudioPromises));
            return "Load Successful";
        });
    }
    _loadMediaSegments(bw) {
        return __awaiter(this, void 0, void 0, function* () {
            const parser = m3u8.createStream();
            let m3uString = this.mediaManifests[bw];
            str2stream(m3uString).pipe(parser);
            return new Promise((resolve, reject) => {
                parser.on("m3u", (m3u) => {
                    let startIdx = 0;
                    let currentMediaSeq = m3u.get("mediaSequence");
                    // Compare mseq counts
                    if (this.segments["video"][bw] && this.segments["video"][bw].mediaSeq) {
                        let storedMseq = this.segments["video"][bw].mediaSeq;
                        let mseqDiff = currentMediaSeq - storedMseq;
                        startIdx =
                            m3u.items.PlaylistItem.length - 1 - mseqDiff < 0
                                ? 0
                                : m3u.items.PlaylistItem.length - 1 - mseqDiff;
                        // Update stored mseq
                        this.segments["video"][bw].mediaSeq = currentMediaSeq;
                    }
                    // For each 'new' playlist item...
                    for (let i = startIdx; i < m3u.items.PlaylistItem.length; i++) {
                        const item = m3u.items.PlaylistItem[i];
                        if (!this.segments["video"][bw]) {
                            this.segments["video"][bw] = {
                                mediaSeq: currentMediaSeq,
                                segList: [],
                            };
                        }
                        let segment = {
                            index: i,
                            duration: item.properties.duration,
                            uri: item.properties.uri,
                        };
                        this.segments["video"][bw].segList.push(segment);
                    }
                    resolve();
                });
                parser.on("error", (exc) => {
                    reject(exc);
                });
            });
        });
    }
    _loadAudioSegments(audioGroup, audioLanguage) {
        return __awaiter(this, void 0, void 0, function* () {
            const parser = m3u8.createStream();
            let m3uString = this.audioManifests[audioGroup][audioLanguage];
            str2stream(m3uString).pipe(parser);
            return new Promise((resolve, reject) => {
                parser.on("m3u", (m3u) => {
                    let startIdx = 0;
                    let currentMediaSeq = m3u.get("mediaSequence");
                    // Compare mseq counts
                    if (this.segments["audio"][audioGroup] &&
                        this.segments["audio"][audioGroup][audioLanguage] &&
                        this.segments["audio"][audioGroup][audioLanguage].mediaSeq) {
                        let storedMseq = this.segments["audio"][audioGroup][audioLanguage].mediaSeq;
                        let mseqDiff = currentMediaSeq - storedMseq;
                        startIdx =
                            m3u.items.PlaylistItem.length - 1 - mseqDiff < 0
                                ? 0
                                : m3u.items.PlaylistItem.length - 1 - mseqDiff;
                        // Update stored mseq
                        this.segments["audio"][audioGroup][audioLanguage].mediaSeq =
                            currentMediaSeq;
                    }
                    // For each 'new' playlist item...
                    for (let i = startIdx; i < m3u.items.PlaylistItem.length; i++) {
                        const item = m3u.items.PlaylistItem[i];
                        if (!this.segments["audio"][audioGroup]) {
                            this.segments["audio"][audioGroup] = {};
                        }
                        if (!this.segments["audio"][audioGroup][audioLanguage]) {
                            this.segments["audio"][audioGroup][audioLanguage] = {
                                mediaSeq: currentMediaSeq,
                                segList: [],
                            };
                        }
                        let audioSegment = {
                            index: i,
                            duration: item.properties.duration,
                            uri: item.properties.uri,
                        };
                        this.segments["audio"][audioGroup][audioLanguage].segList.push(audioSegment);
                    }
                    resolve();
                });
                parser.on("error", (exc) => {
                    reject(exc);
                });
            });
        });
    }
}
exports.HLSRecorder = HLSRecorder;
//# sourceMappingURL=index.js.map