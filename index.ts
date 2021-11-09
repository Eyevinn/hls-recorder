import { EventEmitter } from "events";
import str2stream from "string-to-stream";
import allSettled from "promise.allsettled";
import restify from "restify";
import url from "url";
import { AbortController } from "abort-controller";
/// <reference path="../types/node-fetch-cookies/index.d.ts"/>
import { fetch, CookieJar } from "./util/node-fetch-cookies/src/";
import Debug from "debug";
const debug = Debug("hls-recorder");
const m3u8 = require("@eyevinn/m3u8");
import {
  GenerateMediaM3U8,
  GenerateAudioM3U8,
  GenerateMasterM3U8,
} from "./util/manifest_generator";


import {
  _handleMasterManifest,
  _handleMediaManifest,
  _handleAudioManifest,
  _handleSubtitleManifest,
  IRecData,
} from "./util/handlers.js";

const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface IRecorderOptions {
  recordDuration?: number; // how long in seconds before ending event-stream
  windowSize?: number; // sliding window size
  vod?: boolean; // end event by adding a endlist tag
  vodRealTime?: boolean; // If source is VOD add to recorder manifest in realTime.
}

export type Segment = {
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

type FetchResult = {
  m3u: string;
  mediaSequence: number;
};

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
  subtitle: IAudioSegments;
}

interface IPlaylists {
  video: IMediaManifestList;
  audio: IAudioManifestList;
  subtitle: IAudioManifestList;
}

interface IAudioManifestList {
  [group: string]: { [lang: string]: string };
}

interface IMediaManifestList {
  [bandwidth: number | string]: string;
}

interface m3u {
  items: any;
  properties: any;
  get(key: string): any;
  set(key: string, value: any): any;
}

const enum PlayheadState {
  IDLE = 0,
  RUNNING = 1,
  STOPPED = 2,
  CRASHED = 3,
}

export enum PlaylistType {
  NONE = 0,
  VOD = 1,
  LIVE = 2,
  EVENT = 3,
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
  timeCompensation: boolean;
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
  prevSourceSegCount: number;
  prevMediaSeq: number;
  recorderM3U8TargetDuration: number;
  liveMasterUri: string | null;
  livePlaylistUris: IPlaylists | null;
  sourcePlaylistType: PlaylistType;
  sourceMasterManifest: string;
  sourceMediaManifestURIs: any;
  sourceAudioManifestURIs: any;
  server: any;

  engine: any; // todo channel engine type defs
  cookieJar: CookieJar;
  serverStartTime: number;
  discontinuitySequence: any;
  serverStarted: boolean;
  timerCompensation: boolean | undefined;

  constructor(source: any, opts: IRecorderOptions) {
    super();
    this.serverStarted = false;
    this.cookieJar = new CookieJar();
    this.targetWindowSize = opts.windowSize ? opts.windowSize : -1;
    this.targetRecordDuration = opts.recordDuration ? opts.recordDuration : -1;
    this.addEndTag = opts.vod ? opts.vod : false;
    if (typeof source === "string") {
      if (source.match(/.m3u8/)) {
        this.liveMasterUri = source;
        this.livePlaylistUris = {
          video: {},
          audio: {},
          subtitle: {},
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

    this.timeCompensation = false;
    this.currentWindowSize = 0;
    this.currentRecordDuration = 0;
    this.prevSourceMediaSeq = 0;
    this.prevSourceSegCount = 0;
    this.prevMediaSeq = 0;
    this.recorderM3U8TargetDuration = 0;
    this.playheadState = PlayheadState.IDLE;

    this.sourceMasterManifest = "";
    this.sourceMediaManifestURIs = {};
    this.sourceAudioManifestURIs = {};
    this.sourcePlaylistType = PlaylistType.NONE;

    this.masterManifest = "";
    this.mediaManifests = {};
    this.audioManifests = {};
    this.segments = {
      video: {},
      audio: {},
      subtitle: {},
    };
    let recorderConfigs = {
      Source: this.engine ? "Channel Engine" : source,
      Options: opts,
    };
    debug(`Recorder Configs->: ${recorderConfigs}`);

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
      } else if ((m = req.params.file.match(/master-(\S+)_(\S+)_(\S+).m3u8/))) {
        req.params[0] = m[2];
        req.params[1] = m[3];
        let data: IRecData = {
          mseq: this.prevMediaSeq,
          targetDuration: this.recorderM3U8TargetDuration,
          allSegments: this.segments,
        };
        if (this.discontinuitySequence) {
          data.dseq = this.discontinuitySequence;
        }
        if (m[1] === "audio") {
          await _handleAudioManifest(req, res, next, data);
        } else if (m[1] === "sub") {
          await _handleSubtitleManifest(req, res, next, data);
        }
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
  listen(port: number) {
    this.server.listen(port, () => {
      debug(`${this.server.name} listening at ${this.server.url}`);
    });
    this.serverStarted = true;
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
        this.emit("error", err);
        reject("Something went Wrong!: " + new Error(JSON.stringify(err)));
      }
    });
  }

  stop() {
    return new Promise<string>(async (resolve, reject) => {
      try {
        debug("Stopping HLS Recorder");
        if (this.sourcePlaylistType !== PlaylistType.VOD) {
          debug(
            `Stopping Playhead, creating a VOD, and shutting down the server...`
          );
          this._addEndlistTag();
          this.emit("mseq-increment", {
            allPlaylistSegments: this.segments,
            type: this.sourcePlaylistType,
            cookie: this.cookieJar,
          });
          this.stopPlayhead();
        }
        if (this.serverStarted) {
          this.server.close();
          this.serverStarted = false;
          debug(`Server Closed! [${new Date().toISOString()}]`);
        }
        resolve("Success");
      } catch (err) {
        this.emit("error", err);
        reject(
          "Something went wrong stoping the recorder!: " + JSON.stringify(err)
        );
      }
    });
  }

  async startPlayhead(): Promise<void> {
    // Init playhead state
    this.playheadState = PlayheadState.RUNNING as PlayheadState;

    try {
      // Pre-load
      await this._loadAllManifest();

      // If already a VOD, stop playhead and emitt segments
      if (this.sourcePlaylistType === PlaylistType.VOD) {
        debug("Source is a VOD. Playhead going to stop.");
        this.emit("mseq-increment", {
          allPlaylistSegments: this.segments,
          type: this.sourcePlaylistType,
        });
        this.stopPlayhead();
      }
    } catch (err) {
      console.error(err);
      this.emit("error", err);
      this.playheadState = PlayheadState.STOPPED;
    }
    debug(`Playhead started`);
    while (this.playheadState !== (PlayheadState.CRASHED as PlayheadState)) {
      try {
        if (this.playheadState === (PlayheadState.STOPPED as PlayheadState)) {
          debug(`Playhead Stopped!`);
          return;
        }
        // Let the playhead move at an interval set according to top segment duration
        let segmentDurationMs: any = 6000;
        let videoBws = Object.keys(this.segments["video"]);
        let segmentCount = this.segments["video"][videoBws[0]].segList.length;
        if (videoBws.length > 0 && segmentCount > 0) {
          let lastIdx = segmentCount - 1;
          let segItem = this.segments["video"][videoBws[0]].segList[lastIdx];
          if (segItem.duration) {
            segmentDurationMs = segItem.duration * 1000;
          }
        }

        // Fetch Source Segments, and get ready manifest generation
        // And also compensate for processing time
        const tsIncrementBegin = Date.now();
        await this._loadAllManifest();
        const tsIncrementEnd = Date.now();
        // Is the Event over Case 1
        if (this.sourcePlaylistType === PlaylistType.VOD) {
          debug(
            "Source has become a VOD. And vodRealTime Config is false.",
            "Procceeding to stop Playhead and create a VOD..."
          );
          this.emit("mseq-increment", {
            allPlaylistSegments: this.segments,
            type: this.sourcePlaylistType,
          });
          this.stopPlayhead();
          continue;
        }
        // Is the Event over Case 2?
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
            this.sourcePlaylistType = PlaylistType.VOD;
            this._addEndlistTag();
            this.emit("mseq-increment", {
              allPlaylistSegments: this.segments,
              type: this.sourcePlaylistType,
              cookie: this.cookieJar,
            });
          }
          this.stopPlayhead();
          continue;
        }

        // Set the timer
        let tickInterval = 0;
        tickInterval = segmentDurationMs - (tsIncrementEnd - tsIncrementBegin);
        tickInterval = tickInterval < 2 ? 2 : tickInterval;

        debug(`Playhead going to ping again after ${tickInterval}ms`);

        await timer(tickInterval);
      } catch (err) {
        debug(`Playhead consumer crashed`);
        console.error(err);
        this.emit("error", err);
        this.playheadState = PlayheadState.CRASHED as PlayheadState;
      }
    }
  }

  stopPlayhead(): void {
    debug(`Initialize Stopping of Playhead.`);
    this.playheadState = PlayheadState.STOPPED as PlayheadState;
  }

  async getMasterM3U8() {
    debug(`Master Manifest Requested`);
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
      if (this.sourcePlaylistType === PlaylistType.EVENT) {
        // Prepare possible event to be emitted
        let segCount =
          this.segments["video"][Object.keys(this.segments["video"])[0]].segList
            .length;
        if (segCount > this.prevSourceSegCount) {
          this.prevSourceSegCount = segCount;
          this.emit("mseq-increment", {
            allPlaylistSegments: this.segments,
            type: this.sourcePlaylistType,
          });
        }
      } else {
        // Prepare possible event to be emitted
        let firstMseq =
          this.segments["video"][Object.keys(this.segments["video"])[0]]
            .mediaSeq;
        if (firstMseq > this.prevSourceMediaSeq) {
          this.prevSourceMediaSeq = firstMseq;
          this.emit("mseq-increment", {
            allPlaylistSegments: this.segments,
            type: this.sourcePlaylistType,
          });
        }
      }
      debug(`Iteration of '_loadAllManifest()' done`);
    } catch (err) {
      debug(`Error when loading all manifests!`);
      return Promise.reject(err);
    }
  }

  async _getEngineManifests(): Promise<void> {
    const channelId = "1"; // Read from options maybe?
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
      debug(`Error: Issue retrieving manifests from engine! ${err}`);
      return Promise.reject(err);
    }
  }

  async _getLiveManifests(): Promise<void> {
    // Try to set Live URI
    try {
      // Rewrite Playlist URL in Master
      if (this.sourceMasterManifest === "") {
        debug(`Going to fetch Live Master Manifest!`);
        // Load & Parse all Media Manifest URIs from Master. Set value in sourceMasterManifest
        const parserData = await this._fetchAndParseMasterManifest(
          this.liveMasterUri
        );
        this.livePlaylistUris = parserData.playlistURIs;
        // Replace with m3u8 gen
        this.masterManifest = await GenerateMasterM3U8(parserData.masterM3U);
      }
      await this._fetchAllPlaylistManifest();

      return;
    } catch (err) {
      debug(`Failed to fetch Live Master Manifest! ${err}`);
      return Promise.reject(err);
    }
  }

  // -= M3U8 Load & Parser Functions =-
  async _loadM3u8Segments(): Promise<void> {
    let loadPromises: Promise<void>[] = [];

    // For each bandwidth...
    const bandwidths = Object.keys(this.mediaManifests);
    bandwidths.forEach((bw) => {
      loadPromises.push(this._loadMediaSegments(parseInt(bw)));
    });

    // For each group...
    const audioGroups = Object.keys(this.audioManifests);
    audioGroups.forEach((group) => {
      const audioLangs = Object.keys(this.audioManifests[group]);
      // For each language track...
      for (let i = 0; i < audioLangs.length; i++) {
        const lang = audioLangs[i];
        loadPromises.push(this._loadAudioSegments(group, lang));
      }
    });

    // For each group...
    const subtitleGroups = Object.keys(this.subtitleManifests);
    subtitleGroups.forEach((group) => {
      const subtitleLangs = Object.keys(this.subtitleManifests[group]);
      // For each language track...
      for (let i = 0; i < subtitleLangs.length; i++) {
        const lang = subtitleLangs[i];
        loadPromises.push(this._loadSubtitleSegments(group, lang));
      }
    });
    
    await Promise.all(loadPromises);
    if (this.sourcePlaylistType === PlaylistType.VOD) {
      this._addEndlistTag();
    }
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
        let sourceMediaSeq = m3u.get("mediaSequence");
        let sourceSegCount = m3u.items.PlaylistItem.length;
        this.recorderM3U8TargetDuration = m3u.get("targetDuration");
        if (m3u.get("discontinuitySequence")) {
          this.discontinuitySequence = m3u.get("discontinuitySequence");
        }
        if (this.sourcePlaylistType !== PlaylistType.LIVE) {
          // Compare segment amount
          if (
            this.segments["video"][bw] &&
            this.segments["video"][bw].segList
          ) {
            let storedSegCount = this.segments["video"][bw].segList.length;
            let countDiff = sourceSegCount - storedSegCount;
            startIdx =
              m3u.items.PlaylistItem.length - countDiff < 0
                ? 0
                : m3u.items.PlaylistItem.length - countDiff;
          }
        } else {
          // Compare mseq counts
          if (
            this.segments["video"][bw] &&
            this.segments["video"][bw].mediaSeq
          ) {
            let storedMseq = this.segments["video"][bw].mediaSeq;
            let mseqDiff = sourceMediaSeq - storedMseq;
            startIdx =
              m3u.items.PlaylistItem.length - mseqDiff < 0
                ? 0
                : m3u.items.PlaylistItem.length - mseqDiff;
            // Update stored mseq
            this.segments["video"][bw].mediaSeq = sourceMediaSeq;
          }
        }

        // For each 'new' playlist item...
        for (let i = startIdx; i < m3u.items.PlaylistItem.length; i++) {
          const playlistItem = m3u.items.PlaylistItem[i];
          // Init first time.
          if (!this.segments["video"][bw]) {
            this.segments["video"][bw] = {
              mediaSeq: sourceMediaSeq,
              segList: [],
            };
          }
          let segIdx = this.segments["video"][bw].segList.length + 1;

          let segment;
          if (this.livePlaylistUris) {
            let baseURL = "";
            const m = this.livePlaylistUris["video"][bw].match(/^(.*)\/.*?$/);
            if (m) {
              baseURL = m[1] + "/";
            }
            // Push new segment
            segment = this._playlistItemToSegment(
              playlistItem,
              segIdx,
              baseURL
            );
          } else {
            // Push new segment
            segment = this._playlistItemToSegment(playlistItem, segIdx);
          }
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
        let sourceMediaSeq = m3u.get("mediaSequence");
        let sourceSegCount = m3u.items.PlaylistItem.length;
        if (this.sourcePlaylistType !== PlaylistType.LIVE) {
          // Compare segment amount
          if (
            this.segments["audio"][audioGroup] &&
            this.segments["audio"][audioGroup][audioLanguage] &&
            this.segments["audio"][audioGroup][audioLanguage].segList
          ) {
            let storedSegCount =
              this.segments["audio"][audioGroup][audioLanguage].segList.length;
            let countDiff = sourceSegCount - storedSegCount;
            startIdx =
              m3u.items.PlaylistItem.length - countDiff < 0
                ? 0
                : m3u.items.PlaylistItem.length - countDiff;
          }
        } else {
          // Compare mseq counts
          if (
            this.segments["audio"][audioGroup] &&
            this.segments["audio"][audioGroup][audioLanguage] &&
            this.segments["audio"][audioGroup][audioLanguage].mediaSeq
          ) {
            let storedMseq =
              this.segments["audio"][audioGroup][audioLanguage].mediaSeq;
            let mseqDiff = sourceMediaSeq - storedMseq;
            startIdx =
              m3u.items.PlaylistItem.length - mseqDiff < 0
                ? 0
                : m3u.items.PlaylistItem.length - mseqDiff;
            // Update stored mseq
            this.segments["audio"][audioGroup][audioLanguage].mediaSeq =
              sourceMediaSeq;
          }
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
              mediaSeq: sourceMediaSeq,
              segList: [],
            };
          }
          let segIdx =
            this.segments["audio"][audioGroup][audioLanguage].segList.length +
            1;

          let audioSegment;
          if (this.livePlaylistUris) {
            const baseURL =
              this.livePlaylistUris["audio"][audioGroup][audioLanguage];
            // Push new segment
            audioSegment = this._playlistItemToSegment(
              playlistItem,
              segIdx,
              baseURL
            );
          } else {
            // Push new segment
            audioSegment = this._playlistItemToSegment(playlistItem, segIdx);
          }

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

  async _loadSubtitleSegments(
    subtitleGroup: string,
    subtitleLanguage: string
  ): Promise<void> {
    const parser = m3u8.createStream();
    let m3uString = this.subtitleManifests[subtitleGroup][subtitleLanguage];
    str2stream(m3uString).pipe(parser);

    return new Promise<void>((resolve, reject) => {
      parser.on("m3u", (m3u: any) => {
        let startIdx = 0;
        let currentMediaSeq = m3u.get("mediaSequence");
        // Compare mseq counts
        if (
          this.segments["subtitle"][subtitleGroup] &&
          this.segments["subtitle"][subtitleGroup][subtitleLanguage] &&
          this.segments["subtitle"][subtitleGroup][subtitleLanguage].mediaSeq
        ) {
          let storedMseq =
            this.segments["subtitle"][subtitleGroup][subtitleLanguage].mediaSeq;
          let mseqDiff = currentMediaSeq - storedMseq;
          startIdx =
            m3u.items.PlaylistItem.length - mseqDiff < 0
              ? 0
              : m3u.items.PlaylistItem.length - mseqDiff;
          // Update stored mseq
          this.segments["subtitle"][subtitleGroup][subtitleLanguage].mediaSeq =
            currentMediaSeq;
        }

        // For each 'new' playlist item...
        for (let i = startIdx; i < m3u.items.PlaylistItem.length; i++) {
          const playlistItem = m3u.items.PlaylistItem[i];
          // Init first time.
          if (!this.segments["subtitle"][subtitleGroup]) {
            this.segments["subtitle"][subtitleGroup] = {};
          }
          if (!this.segments["subtitle"][subtitleGroup][subtitleLanguage]) {
            this.segments["subtitle"][subtitleGroup][subtitleLanguage] = {
              mediaSeq: currentMediaSeq,
              segList: [],
            };
          }
          let segIdx =
            this.segments["subtitle"][subtitleGroup][subtitleLanguage].segList
              .length + 1;

          let subtitleSegment;
          if (this.livePlaylistUris) {
            const baseURL =
              this.livePlaylistUris["subtitle"][subtitleGroup][
                subtitleLanguage
              ];
            // Push new segment
            subtitleSegment = this._playlistItemToSegment(
              playlistItem,
              segIdx,
              baseURL
            );
          } else {
            // Push new segment
            subtitleSegment = this._playlistItemToSegment(playlistItem, segIdx);
          }

          this.segments["subtitle"][subtitleGroup][
            subtitleLanguage
          ].segList.push(subtitleSegment);
        }
        resolve();
      });
      parser.on("error", (exc: any) => {
        reject(exc);
      });
    });
  }

  _playlistItemToSegment(
    playlistItem: any,
    idx: number,
    baseUrl?: string
  ): Segment {
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
    let segmentUri: string = "";
    if (playlistItem.properties.uri) {
      if (playlistItem.properties.uri.match("^http")) {
        segmentUri = playlistItem.properties.uri;
      } else {
        if (baseUrl) {
          segmentUri = url.resolve(baseUrl, playlistItem.properties.uri);
        }
      }
    }
    let segment: Segment = {
      index: idx,
      duration: playlistItem.properties.duration,
      uri: segmentUri,
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
                newPlaylistUri = `master${streamItemBw}.m3u8`;
                streamItem.set("uri", newPlaylistUri);
              }
            } else {
              let streamItemBw = streamItem.get("bandwidth");
              newPlaylistUri = `master${streamItemBw}.m3u8`;
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

  _addEndlistTag(): void {
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

      // Add tag for all subtitle
      const groupsSubs = Object.keys(this.segments["subtitle"]);
      groupsSubs.forEach((group) => {
        const langs = Object.keys(this.segments["subtitle"][group]);
        for (let i = 0; i < langs.length; i++) {
          let lang = langs[i];
          this.segments["subtitle"][group][lang].segList.push(finalSegment);
        }
      });

      debug(`Endlist tag! Added to all Media Playlists!`);
    } catch (err) {
      debug(`Error when adding Endlist tag! ${err}`);
      throw new Error(JSON.stringify(err));
    }
  }

  //-----------------------
  // URI Fetch Functions
  //-----------------------
  async _fetchAndParseMasterManifest(
    masterURI: string | null
  ): Promise<{ playlistURIs: IPlaylists; masterM3U: any }> {
    if (masterURI === null) {
      throw new Error(`No master manifest URI provided`);
    }
    const playlistURIs: IPlaylists = {
      video: {},
      audio: {},
      subtitle: {},
    };

    const parser = m3u8.createStream();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      `Request Timeout @ ${masterURI}`;
      controller.abort();
    }, FAIL_TIMEOUT);
    try {
      const response = await fetch(this.cookieJar, masterURI, {
        signal: controller.signal,
        method: "GET",
      });

      if (response.status >= 400 && response.status < 600) {
        let msg = `Failed to validate URI: ${masterURI}\nERROR! Returned Status Code: ${response.status}`;
        debug(msg);
        return Promise.reject(msg);
      }
      // Pipe response to m3u8 parser
      response.body.pipe(parser);
    } catch (err) {
      debug(`Failed to validate URI: ${masterURI}\n Full Error -> ${err}`);
      return Promise.reject(err);
    } finally {
      clearTimeout(timeout);
    }

    return new Promise<{ playlistURIs: IPlaylists; masterM3U: any }>(
      (resolve, reject) => {
        parser.on("m3u", (m3u: any) => {
          debug(`Fetched a New Live Master Manifest from:\n${masterURI}`);
          this.sourceMasterManifest = m3u.toString();

          let baseUrl = "";
          const m = masterURI.match(/^(.*)\/.*?$/);
          if (m) {
            baseUrl = m[1] + "/";
          }
          // Get all Profile manifest URIs in the Live Master Manifest
          for (let i = 0; i < m3u.items.StreamItem.length; i++) {
            const streamItem = m3u.items.StreamItem[i];
            const streamItemBW = streamItem.get("bandwidth");
            const mediaManifestUri = url.resolve(
              baseUrl,
              streamItem.get("uri")
            );
            playlistURIs["video"][streamItemBW] = "";
            playlistURIs["video"][streamItemBW] = mediaManifestUri;
          }

          /*******************************************************************************************
           * Does not account for manifest that exclusively use Stream Items to share playlist urls. *
           * Here we assume that Media Items also include a URI attribute                            *
           *******************************************************************************************/

          let audioMediaItems = m3u.items.MediaItem.filter(
            (mItem: any) => mItem.get("type") === "AUDIO"
          );
          let countAudio = 0;
          for (let i = 0; i < audioMediaItems.length; i++) {
            const mediaItem = audioMediaItems[i];
            let group = mediaItem.attributes.attributes["group-id"];
            let lang = mediaItem.attributes.attributes["language"];
            if (!playlistURIs["audio"][group]) {
              playlistURIs["audio"][group] = {};
            }
            if (!playlistURIs["audio"][group][lang]) {
              playlistURIs["audio"][group][lang] = "";
            }
            const mediaManifestUri = url.resolve(baseUrl, mediaItem.get("uri"));
            playlistURIs["audio"][group][lang] = mediaManifestUri;
            countAudio++;
          }
          // Do the same for Subtitle tracks
          let subtitleMediaItems = m3u.items.MediaItem.filter(
            (mItem: any) => mItem.get("type") === "SUBTITLES"
          );
          let countSubs = 0;
          for (let i = 0; i < subtitleMediaItems.length; i++) {
            const mediaItem = subtitleMediaItems[i];
            let group = mediaItem.attributes.attributes["group-id"];
            let lang = mediaItem.attributes.attributes["language"];
            if (!playlistURIs["subtitle"][group]) {
              playlistURIs["subtitle"][group] = {};
            }
            if (!playlistURIs["subtitle"][group][lang]) {
              playlistURIs["subtitle"][group][lang] = "";
            }
            const mediaManifestUri = url.resolve(baseUrl, mediaItem.get("uri"));
            playlistURIs["subtitle"][group][lang] = mediaManifestUri;
            countSubs++;
          }

          debug(
            `All Live Media Manifest URIs have been collected. (${
              Object.keys(playlistURIs.video).length
            }) media profiles found! ${
              countAudio > 0 ? `with ${countAudio} audio profiles found!` : ""
            }      
            ${countSubs > 0 ? `and ${countSubs} subtitle profiles found!` : ""}`
          );
          const resolveObj = {
            playlistURIs: playlistURIs,
            masterM3U: m3u,
          };
          resolve(resolveObj);
          parser.on("error", (exc: any) => {
            debug(`Parser Error: ${JSON.stringify(exc)}`);
            reject(exc);
          });
        });
      }
    );
  }

  async _fetchAllPlaylistManifest() {
    let FETCH_ATTEMPTS = 10;

    while (FETCH_ATTEMPTS > 0) {
      /**************************************
       * Set up the fetching all playlist [-]
       **************************************/

      // Reset Values Each Attempt
      let livePromises: any[] = [];
      let resultsList: any[] = [];
      let videoPlaylists: { [lang: string]: string } = {};
      let audioPlaylists: { [group: string]: { [lang: string]: string } } = {};
      let subtitlePlaylists: { [group: string]: { [lang: string]: string } } =
        {};
      if (this.livePlaylistUris) {
        videoPlaylists = this.livePlaylistUris.video;
        audioPlaylists = this.livePlaylistUris.audio;
        subtitlePlaylists = this.livePlaylistUris.subtitle;
      }
      try {
        // Append promises for fetching all video playlist
        let bandwidths = Object.keys(videoPlaylists);
        bandwidths.forEach((bw) => {
          livePromises.push(this._fetchPlaylistManifest(videoPlaylists[bw]));
          debug(`Pushed promise for fetching bw=[${bw}_${videoPlaylists[bw]}]`);
        });

        // Append promises for fetching all audio playlist
        let audioGroups = Object.keys(audioPlaylists);
        audioGroups.forEach((group) => {
          let langs = Object.keys(audioPlaylists[group]);
          for (let i = 0; i < langs.length; i++) {
            let lang = langs[i];
            livePromises.push(
              this._fetchPlaylistManifest(audioPlaylists[group][lang])
            );
            debug(`Pushed promise for fetching group_lang=[${group}_${lang}]`);
          }
        });

        // Append promises for fetching all subtitles playlist
        let subtitleGroups = Object.keys(subtitlePlaylists);
        subtitleGroups.forEach((group) => {
          let langs = Object.keys(subtitlePlaylists[group]);
          for (let i = 0; i < langs.length; i++) {
            let lang = langs[i];
            livePromises.push(
              this._fetchPlaylistManifest(subtitlePlaylists[group][lang])
            );
            debug(`Pushed promise for fetching group_lang=[${group}_${lang}]`);
          }
        });

        // Fetch From Live Source
        debug(`Executing Promises I: Fetch From Live Source`);
        resultsList = await allSettled(livePromises);
        livePromises = [];
      } catch (err) {
        debug(`Promises I: FAILURE!\n${err}`);
        return;
      }

      /**************************************
       * Examine what was caught >(  / ' o)
       **************************************/

      // Handle if any promise got rejected
      if (resultsList.some((result) => result.status === "rejected")) {
        debug(`ALERT! Promises I: Failed, Rejection Found! Trying again...`);
        FETCH_ATTEMPTS--;
        continue;
      }

      const allMediaSeqCounts = resultsList.map((item) => {
        if (item.status === "rejected") {
          return -1;
        }
        return item.value.mediaSequence;
      });
      // Handle if mediaSeqCounts are NOT synced up!
      if (
        this.sourcePlaylistType !== PlaylistType.EVENT &&
        !allMediaSeqCounts.every((val, i, arr) => val === arr[0])
      ) {
        debug(`Live Mseq counts=[${allMediaSeqCounts}]`);
        // Decrement fetch counter
        FETCH_ATTEMPTS--;
        // Wait a little before trying again
        debug(
          `[ALERT! Live Source Data NOT in sync! Will try again after 1500ms`
        );
        await timer(1500);
        this.timerCompensation = false; // TODO: implement this right
        continue;
      }

      if (FETCH_ATTEMPTS === 0) {
        debug(
          `Fetching from Live-Source did not work! Returning to Playhead Loop...`
        );
        return;
      }
      debug(
        `Success! Managed to fetch from Live-Source, and all playlists are on the same Media-Sequence_${allMediaSeqCounts[0]}`
      );
      /* APPEND THE GOOD NEWS TO  */
      let valueList = resultsList.map((item) => item.value);
      this.mediaManifests = this._appendToMediaManifests(valueList);
      this.audioManifests = this._appendToAudioManifests(valueList);
      this.subtitleManifests = this._appendToSubtitleManifests(valueList);
      return;
    }
  }

  async _fetchPlaylistManifest(playlistUri: string): Promise<FetchResult> {
    // Get the target media manifest
    const parser = m3u8.createStream();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      debug(`Request Timeout! Aborting Request to ${playlistUri}`);
      controller.abort();
    }, FAIL_TIMEOUT);
    try {
      const response = await fetch(this.cookieJar, playlistUri, {
        method: "GET",
        signal: controller.signal,
      });

      if (response.status >= 400 && response.status < 600) {
        let msg = `Failed to validate URI: ${playlistUri}\nERROR! Returned Status Code: ${response.status}`;
        debug(msg);
        return Promise.reject(msg);
      }

      // CHECK if manifest already has endlist tag
      let text = await response.text();
      if (text.includes("#EXT-X-ENDLIST")) {
        this.sourcePlaylistType = PlaylistType.VOD;
      } else if (text.includes("#EXT-X-PLAYLIST-TYPE:EVENT")) {
        this.sourcePlaylistType = PlaylistType.EVENT;
      } else {
        this.sourcePlaylistType = PlaylistType.LIVE;
      }
      str2stream(text).pipe(parser);
    } catch (err) {
      debug(`Error: Request failed to ${playlistUri}.\nFull Error -> ${err}`);
      return Promise.reject(err);
    } finally {
      clearTimeout(timeout);
    }
    return new Promise((resolve, reject) => {
      parser.on("m3u", (m3u: m3u) => {
        try {
          const result: FetchResult = {
            m3u: m3u.toString(),
            mediaSequence: m3u.get("mediaSequence"),
          };
          resolve(result);
        } catch (exc) {
          debug(`Error when parsing latest manifest`);
          reject(exc);
        }
      });
      parser.on("error", (exc: any) => {
        debug(`Playlist Parser Error: ${JSON.stringify(exc)}`);
        reject(exc);
      });
    });
  }

  _appendToMediaManifests(resultsList: FetchResult[]): IMediaManifestList {
    let LIST: IMediaManifestList = {};
    let bandwidths: string[] = [];
    if (this.livePlaylistUris) {
      bandwidths = Object.keys(this.livePlaylistUris["video"]);
    }

    for (let i = 0; i < bandwidths.length; i++) {
      let bw = bandwidths[i];
      let m3u8Str = resultsList.shift();
      if (m3u8Str) {
        LIST[bw] = m3u8Str.m3u;
      }
    }

    return LIST;
  }

  _appendToAudioManifests(resultsList: FetchResult[]): IAudioManifestList {
    let LIST: IAudioManifestList = {};
    let groups: string[] = [];

    if (this.livePlaylistUris) {
      groups = Object.keys(this.livePlaylistUris["audio"]);
    }
    for (let i = 0; i < groups.length; i++) {
      const group: string = groups[i];
      let langs: string[] = [];
      if (this.livePlaylistUris) {
        langs = Object.keys(this.livePlaylistUris["audio"][group]);
      }
      for (let j = 0; j < langs.length; j++) {
        const lang = langs[j];
        let m3u8Str = resultsList.shift();
        if (m3u8Str) {
          if (!LIST[group]) {
            LIST[group] = {};
          }
          if (!LIST[group][lang]) {
            LIST[group][lang] = "";
          }
          LIST[group][lang] = m3u8Str.m3u;
        }
      }
    }
    return LIST;
  }

  _appendToSubtitleManifests(resultsList: FetchResult[]): IAudioManifestList {
    let LIST: IAudioManifestList = {};
    let groups: string[] = [];

    if (this.livePlaylistUris) {
      groups = Object.keys(this.livePlaylistUris["subtitle"]);
    }
    for (let i = 0; i < groups.length; i++) {
      const group: string = groups[i];
      let langs: string[] = [];
      if (this.livePlaylistUris) {
        langs = Object.keys(this.livePlaylistUris["subtitle"][group]);
      }
      for (let j = 0; j < langs.length; j++) {
        const lang = langs[j];
        let m3u8Str = resultsList.shift();
        if (m3u8Str) {
          if (!LIST[group]) {
            LIST[group] = {};
          }
          if (!LIST[group][lang]) {
            LIST[group][lang] = "";
          }
          LIST[group][lang] = m3u8Str.m3u;
        }
      }
    }
    return LIST;
  }
}
function _addEndlistTag() {
  throw new Error("Function not implemented.");
}

