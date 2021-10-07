import { start } from "repl";

const EventEmitter = require("events").EventEmitter;
const m3u8 = require("@eyevinn/m3u8");
const str2stream = require("string-to-stream");
const debug = require("debug")("recorder");

const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));

interface IRecorderOptions {
  windowSize: number;
  vod: boolean;
}

type Segment = {
  index: number;
  duration: number;
  uri: string;
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

interface ISegments {
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
  windowSize: number;
  segments: ISegments;
  audioManifests: IAudioManifestList;
  mediaManifests: IMediaManifestList;
  masterManifest: string;
  playheadState: PlayheadState;

  constructor(source: any, opts: IRecorderOptions) {
    super();

    this.windowSize = opts.windowSize ? opts.windowSize : -1;
    this.vod = opts.vod ? opts.vod : false;
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

    this.recorderMediaSeq = 0;
    this.playheadState = PlayheadState.IDLE;
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
    return new Promise<string>(async (resolve, reject) => {
      try {
        await this._loadAllManifest();
        //console.log(JSON.stringify(this.segments, null, 2));

        await timer(6000);

        await this._loadAllManifest();
        //console.log(JSON.stringify(this.segments, null, 2));
        resolve("Success");
      } catch (err) {
        reject("Something went Wrong!");
      }
    });
  }

  async startPlayheadAsync() {
    debug(`[]: SessionLive-Playhead consumer started`);
    this.playheadState = PlayheadState.RUNNING;
    while (this.playheadState !== PlayheadState.CRASHED) {
      try {
        // Nothing to do if we have no Live Source to probe
        if (!this.masterManifest) {
          await timer(3000);
          continue;
        }

        // Let the playhead move at an interval set according to live segment duration
        let segmentDurationMs = 6000;
        let videoBws = Object.keys(this.segments["video"]);
        if (
          !videoBws.length &&
          !this.segments["video"][videoBws[0]].segList.length &&
          this.segments["video"][videoBws[0]].segList[0].duration
        ) {
          segmentDurationMs =
            this.segments["video"][videoBws[0]].segList[0].duration * 1000;
        }

        // Fetch Live-Source Segments, and get ready for on-the-fly manifest generation
        // And also compensate for processing time
        const tsIncrementBegin = Date.now();
        await this._loadAllManifests();
        const tsIncrementEnd = Date.now();

        // Set the timer
        let tickInterval = 0;
        tickInterval = segmentDurationMs - (tsIncrementEnd - tsIncrementBegin);
        tickInterval = tickInterval < 2 ? 2 : tickInterval;

        debug(
          `[]: SessionLive-Playhead going to ping again after ${tickInterval}ms`
        );
        await timer(tickInterval);
      } catch (err) {
        debug(`[]: SessionLive-Playhead consumer crashed`);
        debug(err);
        this.playheadState = PlayheadState.CRASHED;
      }
    }
  }

  // Private functions

  //----------------------------------------
  // TODO: Parse and Store from live URI
  //----------------------------------------

  async _loadAllManifest() {
    try {
      if (this.engine) {
        await this._getEngineManifests();
      } else {
        await this._getLiveManifests();
      }
      await this._loadM3u8Segments();

      let firstMseq =
        this.segments["video"][Object.keys(this.segments["video"])[0]].mediaSeq;

      if (firstMseq > this.recorderMediaSeq) {
        this.recorderMediaSeq = firstMseq;
        this.emit("mseq-increment", { mseq: this.recorderMediaSeq });
      }
    } catch (err) {
      console.log("HELLO..");
      return Promise.reject(err);
    }
  }

  async _getLiveManifests() {
    // TODO: . . . use node-fetch
  }

  async _getEngineManifests() {
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

  async _loadM3u8Segments() {
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

    return "Load Successful";
  }

  async _loadMediaSegments(bw: number) {
    const parser = m3u8.createStream();
    let m3uString = this.mediaManifests[bw];
    str2stream(m3uString).pipe(parser);

    return new Promise<void>((resolve, reject) => {
      parser.on("m3u", (m3u: any) => {
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
          let segment: Segment = {
            index: i,
            duration: item.properties.duration,
            uri: item.properties.uri,
          };
          this.segments["video"][bw].segList.push(segment);
        }
        resolve();
      });
      parser.on("error", (exc: any) => {
        reject(exc);
      });
    });
  }

  async _loadAudioSegments(audioGroup: string, audioLanguage: string) {
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
          let audioSegment: Segment = {
            index: i,
            duration: item.properties.duration,
            uri: item.properties.uri,
          };
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
}
