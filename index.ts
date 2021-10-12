const EventEmitter = require("events").EventEmitter;
const m3u8 = require("@eyevinn/m3u8");
const str2stream = require("string-to-stream");
const debug = require("debug")("recorder");
const restify = require("restify");
const errs = require("restify-errors");
const url = require("url");
const urlFetch = require("node-fetch");
const { AbortController } = require("abort-controller");
import {
  GenerateMediaM3U8,
  GenerateAudioM3U8,
} from "./util/manifest_generator";

import {
  _handleMasterManifest,
  _handleMediaManifest,
  _handleAudioManifest,
  IRecData,
} from "./util/handlers";

const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));

interface IRecorderOptions {
  recordDuration?: number; // how long in seconds before ending event-stream
  windowSize?: number; // sliding window size
  vod?: boolean; // end event by adding a endlist tag
}

type Segment = {
  index: number | null;
  duration: number | null;
  uri: string | null;
  endlist?: boolean;
  discontinuity?: boolean;
  daterange?: any;
  cue?: {
    in: boolean;
    out: boolean;
    cont: boolean | null;
    duration: number;
    scteData: string | null;
    assetData: string | null;
  } | null;
};

interface IVideoSegments {
  [bandwidth: number | string]: {
    mediaSeq: number;
    segList: Segment[];
  };
}

interface IAudioSegments {
  [group: string]: {
    [language: string]: {
      mediaSeq: number;
      segList: Segment[];
    };
  };
}

export interface ISegments {
  video: IVideoSegments;
  audio: IAudioSegments;
}

interface IPlaylists {
  video: IMediaManifestList;
  audio: IAudioManifestList;
}

interface IAudioManifestList {
  [group: string]: { [lang: string]: string };
}

interface IMediaManifestList {
  [bandwidth: number | string]: string;
}

type m3u = {
  items: any;
  properties: any;
};

const enum PlayheadState {
  IDLE = 0,
  RUNNING = 1,
  STOPPED = 2,
  CRASHED = 3,
}

const FAIL_TIMEOUT: number = 3000;

/*
         ___
       [|   |=|{)__
        |___| \/   )
HLS      /|\      /|
Recorder/ | \     | \
*/
export class HLSRecorder extends EventEmitter {
  targetWindowSize: number;
  currentWindowSize: number;
  targetRecordDuration: number;
  currentRecordDuration: number;
  addEndTag: boolean;
  segments: ISegments;
  audioManifests: IAudioManifestList;
  mediaManifests: IMediaManifestList;
  masterManifest: any;
  playheadState: PlayheadState;
  prevSourceMediaSeq: number;
  prevMediaSeq: number;
  recorderM3U8TargetDuration: number;
  port: string;
  liveMasterUri: string | null;
  livePlaylistUris: IPlaylists | null;
  engine: any; // todo channel engine type defs

  constructor(source: any, opts: IRecorderOptions) {
    super();

    this.port = process.env.PORT || "8001"; // TODO: get from options
    this.targetWindowSize = opts.windowSize ? opts.windowSize : -1;
    this.targetRecordDuration = opts.recordDuration ? opts.recordDuration : -1;
    this.addEndTag = opts.vod ? opts.vod : false;
    if (typeof source === "string") {
      if (source.match(/master.m3u8/)) {
        this.liveMasterUri = source;
        this.livePlaylistUris = {
          video: {},
          audio: {},
        };
      } else {
        throw new Error("Invalid source URI!");
      }
    } else {
      // Assume user sends a channel-engine instance as input arg
      this.engine = source;
      this.liveMasterUri = null;
      this.livePlaylistUris = null;
    }

    this.currentWindowSize = 0;
    this.currentRecordDuration = 0;
    this.prevSourceMediaSeq = 0;
    this.prevMediaSeq = 0;
    this.recorderM3U8TargetDuration = 0;
    this.playheadState = PlayheadState.IDLE;

    this.sourceMasterManifest = "";
    this.sourceMediaManifestURIs = {};
    this.sourceAudioManifestURIs = {};

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

    // Setup Server [!]
    this.server = restify.createServer();
    this.server.use(restify.plugins.queryParser());
    this.serverStartTime = Date.now();

    const handleMasterRoute = async (req: any, res: any, next: any) => {
      debug(req.params);
      let m;
      if (req.params.file.match(/master.m3u8/)) {
        await _handleMasterManifest(req, res, next, this.masterManifest);
      } else if ((m = req.params.file.match(/master(\d+).m3u8/))) {
        req.params[0] = m[1];
        let data: IRecData = {
          mseq: this.prevMediaSeq,
          targetDuration: this.recorderM3U8TargetDuration,
          allSegments: this.segments,
        };
        if (this.discontinuitySequence) {
          data.dseq = this.discontinuitySequence;
        }
        await _handleMediaManifest(req, res, next, data);
      } else if ((m = req.params.file.match(/master-(\S+)_(\S+).m3u8/))) {
        req.params[0] = m[1];
        req.params[1] = m[2];
        let data: IRecData = {
          mseq: this.prevMediaSeq,
          targetDuration: this.recorderM3U8TargetDuration,
          allSegments: this.segments,
        };
        if (this.discontinuitySequence) {
          data.dseq = this.discontinuitySequence;
        }
        await _handleAudioManifest(req, res, next, data);
      }
    };

    this.server.get("/", (req: any, res: any, next: any) => {
      debug("req.url=" + req.url);
      res.send(200);
      next();
    });
    this.server.get("/live/:file", async (req: any, res: any, next: any) => {
      await handleMasterRoute(req, res, next);
    });
    this.server.get(
      "/channels/:channelId/:file",
      async (req: any, res: any, next: any) => {
        req.query["channel"] = req.params.channelId;
        await handleMasterRoute(req, res, next);
      }
    );
  }

  // ----------------------
  // -= Public functions =-
  // ----------------------
  listen() {
    this.server.listen(this.port, () => {
      debug("%s listening at %s", this.server.name, this.server.url);
    });
  }

  start() {
    return new Promise<string>(async (resolve, reject) => {
      try {
        if (this.engine) {
          this.engine.start();
          await timer(3000);
        }
        // Try to require manifest at set interval
        await this.startPlayhead();
        resolve("Success");
      } catch (err) {
        reject("Something went Wrong!");
      }
    });
  }

  async startPlayhead(): Promise<void> {
    // Pre-load
    await this._loadAllManifest();
    debug(`Playhead started`);
    this.playheadState = PlayheadState.RUNNING as PlayheadState;
    while (this.playheadState !== (PlayheadState.CRASHED as PlayheadState)) {
      try {
        // Nothing to do if we have no Source to probe
        if (!this.masterManifest) {
          await timer(3000);
          continue;
        }

        if (this.playheadState === (PlayheadState.STOPPED as PlayheadState)) {
          debug(`Stopping playhead`);
          return;
        }
        // Let the playhead move at an interval set according to top segment duration
        let segmentDurationMs: any = 6000;
        let videoBws = Object.keys(this.segments["video"]);
        if (
          !videoBws.length &&
          !this.segments["video"][videoBws[0]].segList.length &&
          this.segments["video"][videoBws[0]].segList[0].duration
        ) {
          segmentDurationMs =
            this.segments["video"][videoBws[0]].segList[0].duration;
          segmentDurationMs = segmentDurationMs * 1000;
        }

        // Fetch Source Segments, and get ready manifest generation
        // And also compensate for processing time
        const tsIncrementBegin = Date.now();
        await this._loadAllManifest();
        const tsIncrementEnd = Date.now();

        // Is the Event over?
        if (
          this.targetRecordDuration !== -1 &&
          this.currentRecordDuration >= this.targetRecordDuration
        ) {
          debug(
            `Target Recording Duration of ${
              this.targetRecordDuration
            } is Reached. Stopping Playhead ${
              this.addEndTag ? "and creating a VOD..." : ""
            }`
          );
          if (this.addEndTag) {
            await this._addEndlistTag();
          }
          this.stopPlayhead();
        }

        // Set the timer
        let tickInterval = 0;
        tickInterval = segmentDurationMs - (tsIncrementEnd - tsIncrementBegin);
        tickInterval = tickInterval < 2 ? 2 : tickInterval;

        debug(`Playhead going to ping again after ${tickInterval}ms`);

        await timer(tickInterval);
      } catch (err) {
        debug(`Playhead consumer crashed`);
        debug(err);
        this.playheadState = PlayheadState.CRASHED as PlayheadState;
      }
    }
  }

  stopPlayhead(): void {
    debug(`Initialize Stopping of Playhead.`);
    this.playheadState = PlayheadState.STOPPED as PlayheadState;
  }

  async getMasterM3U8() {
    return this.masterManifest;
  }
    
  async createMediaM3U8(bw: number, segments: ISegments) {
    let data: IRecData = {
      mseq: this.prevMediaSeq,
      targetDuration: this.recorderM3U8TargetDuration,
      allSegments: segments,
    };
    if (this.discontinuitySequence) {
      data.dseq = this.discontinuitySequence;
    }
    return await GenerateMediaM3U8(bw, data);
  }

  async createAudioM3U8(group: string, lang: string, segments: ISegments) {
    let data: IRecData = {
      mseq: this.prevMediaSeq,
      targetDuration: this.recorderM3U8TargetDuration,
      allSegments: segments,
    };
    if (this.discontinuitySequence) {
      data.dseq = this.discontinuitySequence;
    }
    return await GenerateAudioM3U8(group, lang, data);
  }
  // -----------------------
  // -= Private functions =-
  // -----------------------
  async _loadAllManifest(): Promise<void> {
    try {
      if (this.engine) {
        await this._getEngineManifests();
      } else {
        await this._getLiveManifests();
      }
      await this._loadM3u8Segments();
      if (this.targetWindowSize !== -1) {
        debug(`Current Window Size-> [ ${this.currentWindowSize} ] seconds`);
      }
      if (this.targetRecordDuration !== -1) {
        debug(
          `Current Recording Duration-> [ ${this.currentRecordDuration} ] seconds`
        );
      }

      // Prepare possible event to be emitted
      let firstMseq =
        this.segments["video"][Object.keys(this.segments["video"])[0]].mediaSeq;

      if (firstMseq > this.prevSourceMediaSeq) {
        this.prevSourceMediaSeq = firstMseq;
        this.emit("mseq-increment", { allPlaylistSegments: this.segments });
      }
    } catch (err) {
      debug("Error when loading all manifests!", err);
      return Promise.reject(err);
    }
  }

  async _getEngineManifests(): Promise<void> {
    const channelId = "1";
    try {
      if (this.sourceMasterManifest === "") {
        this.sourceMasterManifest = await this.engine.getMasterManifest(
          channelId
        );
        this.masterManifest = this.sourceMasterManifest;
      }
      this.mediaManifests = await this.engine.getMediaManifests(channelId);
      this.audioManifests = await this.engine.getAudioManifests(channelId);
    } catch (err) {
      debug("Error: Issue retrieving manifests from engine!", err);
    }
  }

  // **NOT COMPLETED**
  async _getLiveManifests(): Promise<void> {
    // Try to set Live URI
    try {
      if (this.sourceMasterManifest === "") {
        this.masterManifest = await this._rewritePlaylistURLs(this.sourceMasterManifest);
      }
      debug(`Going to fetch Live Master Manifest!`);
      // Load & Parse all Media Manifest URIs from Master
      this.livePlaylistUris = await this._fetchAndParseMasterManifest(
        this.liveMasterUri
      );

      return;
    } catch (err) {
      this.liveMasterUri = null;
      debug(`Failed to fetch Live Master Manifest! ${err}`);
    }
  }

  // -= M3U8 Load & Parser Functions =-
  async _loadM3u8Segments(): Promise<void> {
    let loadMediaPromises: Promise<void>[] = [];
    let loadAudioPromises: Promise<void>[] = [];

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
    await Promise.all(loadMediaPromises.concat(loadAudioPromises));
    debug(`Segment loading successful!`);
  }

  /**
   * This function should be able to handle parsing media manifest
   * from live streams that may or may not have tags other than (duration, uri)
   * @param bw
   * @returns
   */
  async _loadMediaSegments(bw: number): Promise<void> {
    const parser = m3u8.createStream();
    let m3uString = this.mediaManifests[bw];
    str2stream(m3uString).pipe(parser);

    return new Promise<void>((resolve, reject) => {
      parser.on("m3u", (m3u: any) => {
        let startIdx = 0;
        let currentMediaSeq = m3u.get("mediaSequence");
        this.recorderM3U8TargetDuration = m3u.get("targetDuration");
        if (m3u.get("discontinuitySequence")) {
          this.discontinuitySequence = m3u.get("discontinuitySequence");
        }

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
          // Update current window size (seconds). Only needed for 1 profile.
          if (bw === parseInt(Object.keys(this.segments["video"])[0])) {
            if (this.targetWindowSize !== -1) {
              // TODO: when window is large enough start shifting segments from list.
              this.currentWindowSize += !segment.duration
                ? 0
                : segment.duration;
            }
            if (this.targetRecordDuration !== -1) {
              this.currentRecordDuration += !segment.duration
                ? 0
                : segment.duration;
            }
          }
        }
        resolve();
      });
      parser.on("error", (exc: any) => {
        reject(exc);
      });
    });
  }

  async _loadAudioSegments(
    audioGroup: string,
    audioLanguage: string
  ): Promise<void> {
    const parser = m3u8.createStream();
    let m3uString = this.audioManifests[audioGroup][audioLanguage];
    str2stream(m3uString).pipe(parser);

    return new Promise<void>((resolve, reject) => {
      parser.on("m3u", (m3u: any) => {
        let startIdx = 0;
        let currentMediaSeq = m3u.get("mediaSequence");

        // Compare mseq counts
        if (
          this.segments["audio"][audioGroup] &&
          this.segments["audio"][audioGroup][audioLanguage] &&
          this.segments["audio"][audioGroup][audioLanguage].mediaSeq
        ) {
          let storedMseq =
            this.segments["audio"][audioGroup][audioLanguage].mediaSeq;
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
          this.segments["audio"][audioGroup][audioLanguage].segList.push(
            audioSegment
          );
        }
        resolve();
      });
      parser.on("error", (exc: any) => {
        reject(exc);
      });
    });
  }

  _playlistItemToSegment(playlistItem: any, idx: number): Segment {
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
          "planned-duration": parseFloat(
            attributes["daterange"]["PLANNED-DURATION"]
          ),
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
    } else if (typeof cueOutCont !== "undefined") {
      duration = playlistItem.get("cont-dur");
    }
    let cue =
      cueOut || cueIn || cueOutCont || assetData
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
    let segment: Segment = {
      index: idx,
      duration: playlistItem.properties.duration,
      uri: playlistItem.properties.uri,
      cue: cue,
    };
    return segment;
  }

  async _rewritePlaylistURLs(sourceMasterManifest: string): Promise<string> {
    const parser = m3u8.createStream();
    str2stream(sourceMasterManifest).pipe(parser);

    return new Promise<string>((resolve, reject) => {
      parser.on("m3u", (m3u: any) => {
        let newPlaylistUri = "";

        for (let i = 0; i < m3u.items.StreamItem.length; i++) {
          const streamItem = m3u.items.StreamItem[i];
          if (streamItem.get("bandwidth")) {
            if (streamItem.attributes.attributes["audio"]) {
              let audioStreamItem = m3u.items.MediaItem.find(
                (mediaItem: any) => {
                  if (
                    mediaItem.get("type") === "AUDIO" &&
                    mediaItem.get("uri") === streamItem.get("uri")
                  ) {
                    return mediaItem;
                  }
                }
              );
              if (audioStreamItem) {
                let group = audioStreamItem.attributes.attributes["group-id"];
                let lang = audioStreamItem.attributes.attributes["language"];
                newPlaylistUri = `master-${group}_${lang}.m3u8`;
                streamItem.set("uri", newPlaylistUri);
              } else {
                let streamItemBw = streamItem.get("bandwidth");
                newPlaylistUri = `master-blaster-${streamItemBw}.m3u8`;
                streamItem.set("uri", newPlaylistUri);
              }
            } else {
              let streamItemBw = streamItem.get("bandwidth");
              newPlaylistUri = `master-blaster-${streamItemBw}.m3u8`;
              streamItem.set("uri", newPlaylistUri);
            }
          }
        }

        for (let i = 0; i < m3u.items.MediaItem.length; i++) {
          const mediaItem = m3u.items.MediaItem[i];
          if (mediaItem.get("type") === "AUDIO") {
            let group = mediaItem.attributes.attributes["group-id"];
            let lang = mediaItem.attributes.attributes["language"];
            newPlaylistUri = `master-${group}_${lang}.m3u8`;
            mediaItem.set("uri", newPlaylistUri);
          }
        }
        resolve(m3u.toString());
      });
      parser.on("error", (exc: any) => {
        reject(exc);
      });
    });
  }

  async _addEndlistTag(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const finalSegment: Segment = {
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
      } catch (err) {
        debug(`Error when adding Endlist tag! ${err}`);
        reject(err);
      }
    });
  }

  //-----------------------
  // URI Fetch Functions
  //-----------------------
  /**
   * _fetchAndParseMasterManifest(string)
   * TODO: _fetchAndParseMediaManifest(string)
   * TODO: _loadMediaManifest(number)
   */
  async _fetchAndParseMasterManifest(
    masterURI: string | null
  ): Promise<IPlaylists> {
    if (masterURI === null) {
      throw new Error(`No master manifest URI provided`);
    }
    const playlistURIs: IPlaylists = {
      video: {},
      audio: {},
    };
    const parser = m3u8.createStream();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      debug(`Request Timeout! Aborting Request to ${masterURI}`);
      controller.abort();
    }, FAIL_TIMEOUT);

    const response = await urlFetch(masterURI, { signal: controller.signal });

    try {
      response.body.pipe(parser);
    } catch (err) {
      debug(`Error when piping response to parser! ${JSON.stringify(err)}`);
      return Promise.reject(err);
    } finally {
      clearTimeout(timeout);
    }

    return new Promise<IPlaylists>((resolve, reject) => {
      parser.on("m3u", (m3u: any) => {
        debug(`Fetched a New Live Master Manifest from:\n${masterURI}`);
        let baseUrl = "";
        const m = masterURI.match(/^(.*)\/.*?$/);
        if (m) {
          baseUrl = m[1] + "/";
        }
        // Get all Profile manifest URIs in the Live Master Manifest
        for (let i = 0; i < m3u.items.StreamItem.length; i++) {
          const streamItem = m3u.items.StreamItem[i];
          const streamItemBW = streamItem.get("bandwidth");
          const mediaManifestUri = url.resolve(baseUrl, streamItem.get("uri"));
          playlistURIs["video"][streamItemBW] = "";
          playlistURIs["video"][streamItemBW] = mediaManifestUri;
        }

        // TODO: support Live source with Demuxed Audio

        debug(
          `All Live Media Manifest URIs have been collected. (${
            Object.keys(playlistURIs).length
          }) profiles found!`
        );
        resolve(playlistURIs);
        parser.on("error", (exc: any) => {
          debug(`Parser Error: ${JSON.stringify(exc)}`);
          reject(exc);
        });
      });
    });
  }

  async _fetchAndParseMediaManifest(mediaURI: string) {
    let FETCH_ATTEMPTS = 10;

    while (FETCH_ATTEMPTS > 0) {
      // Reset Values Each Attempt
      let livePromises = [];
      let resultsList = [];
      let playlistAmount = Object.keys(this.playlistURIs["video"]).length;
      try {
        // Collect Live Source Requesting Promises
        for (let i = 0; i < playlistAmount; i++) {
          let bw = Object.keys(this.playlistURIs["video"])[i];
          livePromises.push(this._loadMediaManifest(parseInt(bw)));
          debug(`Pushed loadMedia promise for bw=[${bw}]`);
        }
        // Fetch From Live Source
        debug(`Executing Promises I: Fetch From Live Source`);
        resultsList = await Promise.allSettled(livePromises);
        livePromises = [];
      } catch (err) {
        debug(`[${this.sessionId}]: Promises I: FAILURE!\n${err}`);
        return;
      }

      // Handle if any promise got rejected
      if (resultsList.some((result) => result.status === "rejected")) {
        debug(
          `[${this.sessionId}]: ALERT! Promises I: Failed, Rejection Found! Trying again...`
        );
        continue;
      }

      const allMediaSeqCounts = resultsList.map((item) => {
        if (item.status === "rejected") {
          return -1;
        }
        return item.value.properties.mediaSequence;
      });

      // Handle if mediaSeqCounts are NOT synced up!
      if (!allMediaSeqCounts.every((val, i, arr) => val === arr[0])) {
        debug(`[${this.sessionId}]: Live Mseq counts=[${allMediaSeqCounts}]`);
        // Decrement fetch counter
        FETCH_ATTEMPTS--;
        // Wait a little before trying again
        debug(
          `[${this.sessionId}]: ALERT! Live Source Data NOT in sync! Will try again after 1500ms`
        );
        await timer(1500);
        this.timerCompensation = false;
        continue;
      }

      if (FETCH_ATTEMPTS === 0) {
        debug(
          `[${this.sessionId}]: Fetching from Live-Source did not work! Returning to Playhead Loop...`
        );
        return;
      }

      if (this.allowedToSet) {
        // Collect and Push Segment-Extracting Promises
        let pushPromises = [];
        for (let i = 0; i < Object.keys(this.mediaManifestURIs).length; i++) {
          let bw = Object.keys(this.mediaManifestURIs)[i];
          pushPromises.push(
            this._parseMediaManifest(
              this.liveSourceM3Us[bw].M3U,
              bw,
              this.mediaManifestURIs[bw],
              bw
            )
          );
          //debug(`[${this.sessionId}]: Pushed pushPromise for bw=${bw}`);
        }

        // Segment Pushing
        debug(`[${this.sessionId}]: Executing Promises II: Segment Pushing`);
        await Promise.all(pushPromises);
      }
    }
  }

  //TODO: Continue here!

  async _loadMediaManifest(bw: number): Promise<m3u> {
    // Get the target media manifest
    const mediaManifestUri = this.playlistURIs["video"][bw];
    const parser = m3u8.createStream();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      debug(
        `[${this.sessionId}]: Request Timeout! Aborting Request to ${mediaManifestUri}`
      );
      controller.abort();
    }, FAIL_TIMEOUT);

    const response = await urlFetch(mediaManifestUri, {
      signal: controller.signal,
    });
    try {
      response.body.pipe(parser);
    } catch (err) {
      debug(`Error when piping response to parser! ${JSON.stringify(err)}`);
      return Promise.reject(err);
    } finally {
      clearTimeout(timeout);
    }
    return new Promise((resolve, reject) => {
      parser.on("m3u", (m3u: m3u) => {
        try {
          resolve(m3u);
        } catch (exc) {
          debug(`[${this.sessionId}]: Error when parsing latest manifest`);
          reject(exc);
        }
      });
      parser.on("error", (exc: any) => {
        debug(`Parser Error: ${JSON.stringify(exc)}`);
        reject(exc);
      });
    });
  }
}
