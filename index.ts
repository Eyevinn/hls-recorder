const EventEmitter = require("events").EventEmitter;
const m3u8 = require("@eyevinn/m3u8");
const str2stream = require("string-to-stream");
const debug = require("debug")("recorder");
const restify = require("restify");
const errs = require("restify-errors");

import {
  _handleMasterManifest,
  _handleMediaManifest,
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

interface IAudioManifestList {
  [group: string]: { [lang: string]: string };
}

interface IMediaManifestList {
  [bandwidth: number | string]: string;
}

const enum PlayheadState {
  IDLE = 0,
  RUNNING = 1,
  STOPPED = 2,
  CRASHED = 3,
}

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
  recorderM3U8TargetDuration: number;
  port: number;

  constructor(source: any, opts: IRecorderOptions) {
    super();

    this.port = 8001; // TODO: get from options
    this.targetWindowSize = opts.windowSize ? opts.windowSize : -1;
    this.targetRecordDuration = opts.recordDuration ? opts.recordDuration : -1;
    this.addEndTag = opts.vod ? opts.vod : false;
    if (typeof source === "string") {
      if (source.match(/master.m3u8/)) {
        this.liveMasterUri = source;
      } else {
        throw new Error("Invalid source URI!");
      }
    } else {
      // Assume user sends a channel-engine instance as input arg
      this.engine = source;
    }

    this.currentWindowSize = 0;
    this.currentRecordDuration = 0;
    this.prevSourceMediaSeq = 0;
    this.recorderM3U8TargetDuration = 0;
    this.playheadState = PlayheadState.IDLE;
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

    const handleMasterRoute = async (req: any, res: any, next: any) => {
      debug(req.params);
      let m;
      if (req.params.file.match(/master.m3u8/)) {
        await _handleMasterManifest(req, res, next, this.masterManifest);
      } else if (
        (m = req.params.file.match(/master(\d+).m3u8;session=(.*)$/))
      ) {
        req.params[0] = m[1];
        req.params[1] = m[2];
        let data: IRecData = {
          bw: m[1],
          mseq: 1,
          targetDuration: this.recorderM3U8TargetDuration,
          allSegments: this.segments,
        };
        await _handleMediaManifest(req, res, next, data);
      } else if (
        (m = req.params.file.match(/master-(\S+)_(\S+).m3u8;session=(.*)$/))
      ) {
        // NOT READY...
        req.params[0] = m[1];
        req.params[1] = m[2];
        req.params[2] = m[3];
        //await this._handleAudioManifest(req, res, next);
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

  // Public Functions
  start() {
    this.server.listen(this.port, () => {
      debug("%s listening at %s", this.server.name, this.server.url);
    });

    return new Promise<string>(async (resolve, reject) => {
      try {
        await this.startPlayhead();

        resolve("Success");
      } catch (err) {
        reject("Something went Wrong!");
      }
    });
  }

  async startPlayhead(): Promise<void> {
    // Pre-load (maybe skip this? need to test more)
    await this._loadAllManifest();
    debug(`Playhead consumer started`);
    this.playheadState = PlayheadState.RUNNING as PlayheadState;
    while (this.playheadState !== (PlayheadState.CRASHED as PlayheadState)) {
      try {
        // Nothing to do if we have no Source to probe
        if (!this.masterManifest) {
          await timer(3000);
          continue;
        }

        if (this.playheadState === (PlayheadState.STOPPED as PlayheadState)) {
          debug(`[]: Stopping playhead`);
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

        console.log(`Playhead going to ping again after ${tickInterval}ms`);

        await timer(tickInterval);
      } catch (err) {
        debug(`Playhead consumer crashed`);
        debug(err);
        this.playheadState = PlayheadState.CRASHED as PlayheadState;
      }
    }
  }

  stopPlayhead(): void {
    debug(`[]: Stopping playhead consumer`);
    this.playheadState = PlayheadState.STOPPED as PlayheadState;
  }

  // Private functions

  //----------------------------------------
  // TODO: Parse and Store from live URI
  //----------------------------------------

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
        this.emit("mseq-increment", { mseq: this.prevSourceMediaSeq });
      }
    } catch (err) {
      console.log("HELLO..");
      return Promise.reject(err);
    }
  }

  async _getLiveManifests(): Promise<void> {
    // TODO: . . . use 'node-fetch' on True Live stream
  }

  async _getEngineManifests(): Promise<void> {
    const channelId = "1";
    try {
      if (this.masterManifest === "") {
        this.masterManifest = await this.engine.getMasterManifest(channelId);
      }
      this.mediaManifests = await this.engine.getMediaManifests(channelId);
      this.audioManifests = await this.engine.getAudioManifests(channelId);
    } catch (err) {
      console.error("Error: Issue retrieving manifests from engine!", err);
    }
  }

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
            if (this.targetWindowSize !== -1) {
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
}
