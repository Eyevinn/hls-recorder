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
const restify = require("restify");
const errs = require("restify-errors");
const handlers_1 = require("./util/handlers");
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
        this.port = 8001; // TODO: get from options
        this.targetWindowSize = opts.windowSize ? opts.windowSize : -1;
        this.addEndTag = opts.vod ? opts.vod : false;
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
        this.currentWindowSize = 0;
        this.prevSourceMediaSeq = 0;
        this.recorderTargetDuration = 0;
        this.playheadState = 0 /* IDLE */;
        this.masterManifest = "";
        this.mediaManifests = {};
        this.audioManifests = {};
        this.segments = {
            video: {},
            audio: {},
        };
        let recorderConfigs = {
            Source: this.engine ? "Channel Engine" : source,
            Options: opts,
        };
        debug("Recorder Configs->:", recorderConfigs);
        // Setup Server [!] Borrowed from server.js in channelengine, TODO: tidy up
        this.server = restify.createServer();
        this.server.use(restify.plugins.queryParser());
        this.serverStartTime = Date.now();
        const handleMasterRoute = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            debug(req.params);
            let m;
            if (req.params.file.match(/master.m3u8/)) {
                yield (0, handlers_1._handleMasterManifest)(req, res, next, this.masterManifest);
            }
            else if ((m = req.params.file.match(/master(\d+).m3u8;session=(.*)$/))) {
                req.params[0] = m[1];
                req.params[1] = m[2];
                let data = {
                    bw: m[1],
                    mseq: 1,
                    targetDuration: this.recorderTargetDuration,
                    allSegments: this.segments,
                };
                yield (0, handlers_1._handleMediaManifest)(req, res, next, data);
            }
            else if ((m = req.params.file.match(/master-(\S+)_(\S+).m3u8;session=(.*)$/))) {
                // NOT READY...
                req.params[0] = m[1];
                req.params[1] = m[2];
                req.params[2] = m[3];
                //await this._handleAudioManifest(req, res, next);
            }
        });
        this.server.get("/", (req, res, next) => {
            debug("req.url=" + req.url);
            res.send(200);
            next();
        });
        this.server.get("/live/:file", (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            yield handleMasterRoute(req, res, next);
        }));
        this.server.get("/channels/:channelId/:file", (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            req.query["channel"] = req.params.channelId;
            yield handleMasterRoute(req, res, next);
        }));
    }
    // Public Functions
    start() {
        this.server.listen(this.port, () => {
            debug("%s listening at %s", this.server.name, this.server.url);
        });
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.startPlayhead();
                resolve("Success");
            }
            catch (err) {
                reject("Something went Wrong!");
            }
        }));
    }
    startPlayhead() {
        return __awaiter(this, void 0, void 0, function* () {
            // Pre-load
            yield this._loadAllManifest();
            debug(`Playhead consumer started`);
            this.playheadState = 1 /* RUNNING */;
            while (this.playheadState !== 3 /* CRASHED */) {
                try {
                    console.log("IM INSDIE PLAYH");
                    // Nothing to do if we have no Live Source to probe
                    if (!this.masterManifest) {
                        yield timer(3000);
                        continue;
                    }
                    if (this.playheadState === 2 /* STOPPED */) {
                        debug(`[]: Stopping playhead`);
                        return;
                    }
                    // Let the playhead move at an interval set according to top segment duration
                    let segmentDurationMs = 6000;
                    let videoBws = Object.keys(this.segments["video"]);
                    if (!videoBws.length &&
                        !this.segments["video"][videoBws[0]].segList.length &&
                        this.segments["video"][videoBws[0]].segList[0].duration) {
                        segmentDurationMs =
                            this.segments["video"][videoBws[0]].segList[0].duration;
                        segmentDurationMs = segmentDurationMs * 1000;
                    }
                    // Fetch Live-Source Segments, and get ready for on-the-fly manifest generation
                    // And also compensate for processing time
                    const tsIncrementBegin = Date.now();
                    yield this._loadAllManifest();
                    const tsIncrementEnd = Date.now();
                    if (this.targetWindowSize !== -1 &&
                        this.currentWindowSize >= this.targetWindowSize) {
                        debug(`[]: Target Window Size of ${this.targetWindowSize} is Reached. Stopping Playhead ${this.addEndTag ? "and creating a VOD..." : ""}`);
                        yield this._addEndlistTag();
                        this.stopPlayhead();
                    }
                    // Set the timer
                    let tickInterval = 0;
                    tickInterval = segmentDurationMs - (tsIncrementEnd - tsIncrementBegin);
                    tickInterval = tickInterval < 2 ? 2 : tickInterval;
                    console.log(`Playhead going to ping again after ${tickInterval}ms`);
                    yield timer(tickInterval);
                }
                catch (err) {
                    debug(`Playhead consumer crashed`);
                    debug(err);
                    this.playheadState = 3 /* CRASHED */;
                }
            }
        });
    }
    stopPlayhead() {
        debug(`[]: Stopping playhead consumer`);
        this.playheadState = 2 /* STOPPED */;
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
                debug(`Current Window Size-> ${this.currentWindowSize} seconds`);
                // Prepare possible event to be emitted
                let firstMseq = this.segments["video"][Object.keys(this.segments["video"])[0]].mediaSeq;
                if (firstMseq > this.prevSourceMediaSeq) {
                    this.prevSourceMediaSeq = firstMseq;
                    this.emit("mseq-increment", { mseq: this.prevSourceMediaSeq });
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
            // TODO: . . . use 'node-fetch' on True Live stream
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
            debug(`Segment loading successful!`);
        });
    }
    /**
     * This function should be able to handle parsing media manifest
     * from live streams that may or may not have tags other than (duration, uri)
     * @param bw
     * @returns
     */
    _loadMediaSegments(bw) {
        return __awaiter(this, void 0, void 0, function* () {
            const parser = m3u8.createStream();
            let m3uString = this.mediaManifests[bw];
            str2stream(m3uString).pipe(parser);
            return new Promise((resolve, reject) => {
                parser.on("m3u", (m3u) => {
                    let startIdx = 0;
                    let currentMediaSeq = m3u.get("mediaSequence");
                    this.recorderTargetDuration = m3u.get("targetDuration");
                    // Compare mseq counts
                    if (this.segments["video"][bw] && this.segments["video"][bw].mediaSeq) {
                        let storedMseq = this.segments["video"][bw].mediaSeq;
                        let mseqDiff = currentMediaSeq - storedMseq;
                        startIdx =
                            m3u.items.PlaylistItem.length - mseqDiff < 0
                                ? 0
                                : m3u.items.PlaylistItem.length - mseqDiff;
                        // Update stored mseq
                        this.segments["video"][bw].mediaSeq = currentMediaSeq;
                    }
                    // For each 'new' playlist item...
                    for (let i = startIdx; i < m3u.items.PlaylistItem.length; i++) {
                        const playlistItem = m3u.items.PlaylistItem[i];
                        // Init first time.
                        if (!this.segments["video"][bw]) {
                            this.segments["video"][bw] = {
                                mediaSeq: currentMediaSeq,
                                segList: [],
                            };
                        }
                        // Push new segment
                        let segment = this._playlistItemToSegment(playlistItem, i);
                        this.segments["video"][bw].segList.push(segment);
                        //debug(`Pushed a new Segment! bw=${bw}`)
                        // Update current window size (seconds). Only needed for 1 profile.
                        if (bw === parseInt(Object.keys(this.segments["video"])[0])) {
                            this.currentWindowSize += !segment.duration ? 0 : segment.duration;
                        }
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
                        const playlistItem = m3u.items.PlaylistItem[i];
                        // Init first time.
                        if (!this.segments["audio"][audioGroup]) {
                            this.segments["audio"][audioGroup] = {};
                        }
                        if (!this.segments["audio"][audioGroup][audioLanguage]) {
                            this.segments["audio"][audioGroup][audioLanguage] = {
                                mediaSeq: currentMediaSeq,
                                segList: [],
                            };
                        }
                        // Push new segment
                        let audioSegment = this._playlistItemToSegment(playlistItem, i);
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
    _playlistItemToSegment(playlistItem, idx) {
        let attributes = playlistItem["attributes"].attributes;
        // for EXT-X-DISCONTINUITY
        if (playlistItem.properties.discontinuity) {
            return {
                index: null,
                duration: null,
                uri: null,
                discontinuity: true,
            };
        }
        // for EXT-X-DATERANGE
        if ("daterange" in attributes) {
            return {
                index: null,
                duration: null,
                uri: null,
                daterange: {
                    id: attributes["daterange"]["ID"],
                    "start-date": attributes["daterange"]["START-DATE"],
                    "planned-duration": parseFloat(attributes["daterange"]["PLANNED-DURATION"]),
                },
            };
        }
        // for all EXT-X-CUE related tags.
        let assetData = playlistItem.get("assetdata");
        let cueOut = playlistItem.get("cueout");
        let cueIn = playlistItem.get("cuein");
        let cueOutCont = playlistItem.get("cont-offset");
        let duration = 0;
        let scteData = playlistItem.get("sctedata");
        if (typeof cueOut !== "undefined") {
            duration = cueOut;
        }
        else if (typeof cueOutCont !== "undefined") {
            duration = playlistItem.get("cont-dur");
        }
        let cue = cueOut || cueIn || cueOutCont || assetData
            ? {
                out: typeof cueOut !== "undefined",
                cont: typeof cueOutCont !== "undefined" ? cueOutCont : null,
                scteData: typeof scteData !== "undefined" ? scteData : null,
                in: cueIn ? true : false,
                duration: duration,
                assetData: typeof assetData !== "undefined" ? assetData : null,
            }
            : null;
        // For Normal #EXTINF + url
        let segment = {
            index: idx,
            duration: playlistItem.properties.duration,
            uri: playlistItem.properties.uri,
            cue: cue,
        };
        return segment;
    }
    _addEndlistTag() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                try {
                    const finalSegment = {
                        index: null,
                        duration: null,
                        uri: null,
                        endlist: true,
                    };
                    // Add tag to for all media
                    const bandwidths = Object.keys(this.segments["video"]);
                    bandwidths.forEach((bw) => {
                        this.segments["video"][bw].segList.push(finalSegment);
                    });
                    // Add tag for all audio
                    const groups = Object.keys(this.segments["audio"]);
                    groups.forEach((group) => {
                        const langs = Object.keys(this.segments["audio"][group]);
                        for (let i = 0; i < langs.length; i++) {
                            let lang = langs[i];
                            this.segments["audio"][group][lang].segList.push(finalSegment);
                        }
                    });
                    debug(`Endlist tag! Added to all Media Playlists!`);
                    resolve();
                }
                catch (err) {
                    debug(`Error when adding Endlist tag! ${err}`);
                    reject(err);
                }
            });
        });
    }
}
exports.HLSRecorder = HLSRecorder;
//# sourceMappingURL=index.js.map