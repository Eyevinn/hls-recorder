
export interface IVideoTracks {
  bandwidth: number;
  width: number;
  height: number;
  codecs: string;
  frameRate?: number;
  audio?: string;
  subtitle?: string;
}

export interface ISetMultiVariantInput {
  videoTracks: IVideoTracks[];
  audioTracks?: IExtraTracks[];
  subtitleTracks?: IExtraTracks[];
}

export interface IExtraTracks {
  groupId: string;
  language: string;
  name: string;
  default: boolean;
}

export enum EnumStreamType {
  "NONE" = 0,
  "EVENT" = 1,
  "LIVE" = 2,
  "VOD" = 3,
}

export interface IInsertAtInput {
  replacementString: string;
  targetSegmentIndex: number;
  stopAfter: boolean;
}

export interface IGetMediaPlaylistM3U8Options {
  keyString?: string;
  mapString?: string;
}
export interface ISetInitPlaylistDataInput {
  MSEQ: number,         // starting media-sequence value
  DSEQ: number,         // starting discontinuity-sequence value
  TARGET_DUR: number,   // duration for each segment in playlist
  START_ON: number,     // top segment in playlist has this index value
  END_ON: number,       // last segment in playlist has this index value
}
/*
Mock Live HLS M3U8 Maker
  o     _______________________________
 /\_  _|          |                   |
_\__`[____________|___________________| 
] [ \,      ][               ][
------------------------------------------------
*/
export class MockLiveM3U8Generator {
  header: string;
  multiVariantM3u8: string;
  //eventStreamData: ILiveStreamPlaylistMetadata | null;
  liveStreamData: { [key: string]: ISetInitPlaylistDataInput } | any;
  targetSegment: number;
  replacementString: string;
  breakLoop: boolean;

  constructor() {
    this.header = `#EXTM3U
#EXT-X-VERSION:7`;
    this.multiVariantM3u8 = "<Not Set>";
    this.targetSegment = -1;
    this.replacementString = "";
    this.liveStreamData = {};
    this.breakLoop = false;
  }

  shiftSegments(variant: string, numOfSegs: number) {
    if (this.liveStreamData) {
      this.liveStreamData[variant].START_ON += numOfSegs;
      this.liveStreamData[variant].MSEQ += numOfSegs;
    }
  }

  pushSegments(variant: string, numOfSegs: number) {
    if (this.liveStreamData) {
      this.liveStreamData[variant].END_ON += numOfSegs;
    }
  }

  setInitPlaylistData(initData: ISetInitPlaylistDataInput) {
    if (this.liveStreamData && Object.keys(this.liveStreamData).length > 0) {
      Object.keys(this.liveStreamData).forEach((variant) => {
        if (this.liveStreamData && this.liveStreamData[variant]) {
          this.liveStreamData[variant] = JSON.parse(JSON.stringify(initData));
        }
      });
    }
  }

  /**
   * Will insert the replacement string at given segment index when building
   * the manifest string. You do not need to add a first '\n' as it is prefixed
   * internally. If you want to prevent adding more segments after the given
   * index then set stopAfter to true.
   * @param input
   */
  insertAt(input: IInsertAtInput) {
    this.targetSegment = input.targetSegmentIndex;
    this.replacementString = input.replacementString;
    this.breakLoop = input.stopAfter;
  }

  getMediaPlaylistM3U8(type: EnumStreamType, variant: string, opts?: IGetMediaPlaylistM3U8Options) {
    let data: ISetInitPlaylistDataInput;
    if (!this.liveStreamData) {
      return "Error";
    }
    data = this.liveStreamData[variant];
    let manifest = "";
    manifest += this.header;
    if (type === EnumStreamType.EVENT) {
      manifest += `\n#EXT-X-PLAYLIST-TYPE:EVENT`;
    } else if (type === EnumStreamType.VOD) {
      manifest += `\n#EXT-X-PLAYLIST-TYPE:VOD`;
    }
    manifest += `\n#EXT-X-TARGETDURATION:${data.TARGET_DUR}`;
    manifest += `\n#EXT-X-DISCONTINUITY-SEQUENCE:${data.DSEQ}`;
    manifest += `\n#EXT-X-MEDIA-SEQUENCE:${data.MSEQ}`;

    if (opts && opts.mapString) {
      manifest += `\n${opts.mapString}`;
    }
    if (opts && opts.keyString) {
      manifest += `\n${opts.keyString}`;
    }

    for (let i = data.START_ON; i < data.END_ON; i++) {
      // Do something Special at this segment?
      if (this.targetSegment === i) {
        manifest += "\n" + this.replacementString;
        if (this.breakLoop) {
          break;
        }
      }
      // Add usual segment data
      manifest += `\n#EXTINF:${data.TARGET_DUR}`;
      if (opts && opts.mapString) {
        manifest += `\n${variant}-seg_${i}.m4s`;
      } else {
        manifest += `\n${variant}-seg_${i}.ts`;
      }
    }

    return manifest;
  }

  setMultiVariant(opts: ISetMultiVariantInput): void {
    let manifest = "";
    manifest += this.header;

    // Add possible Audio Tracks
    if (opts.audioTracks) {
      manifest += "\n";
      opts.audioTracks.forEach((track) => {
        manifest += `\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${track.groupId}",LANGUAGE="${
          track.language
        }",NAME="${track.name}",CHANNELS="2",DEFAULT=${
          track.default ? "YES" : "NO"
        },AUTOSELECT=YES,URI="audio-${track.groupId}_${track.language}.m3u8"`;

        if (
          this.liveStreamData &&
          !this.liveStreamData[`audio-${track.groupId}_${track.language}`]
        ) {
          this.liveStreamData[`audio-${track.groupId}_${track.language}`] = {
            MSEQ: 0,
            DSEQ: 0,
            TARGET_DUR: 10,
            START_ON: 0,
            END_ON: 6,
          };
        }
      });
    }
    // Add possible Subtitle Tracks
    if (opts.subtitleTracks) {
      manifest += "\n";
      opts.subtitleTracks.forEach((track) => {
        manifest += `\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="${track.groupId}",LANGUAGE="${
          track.language
        }",NAME="${track.name}",FORCED=NO,DEFAULT=${
          track.default ? "YES" : "NO"
        },AUTOSELECT=YES,URI="sub-${track.groupId}_${track.language}.m3u8"`;

        if (this.liveStreamData && !this.liveStreamData[`sub-${track.groupId}_${track.language}`]) {
          this.liveStreamData[`sub-${track.groupId}_${track.language}`] = {
            MSEQ: 0,
            DSEQ: 0,
            TARGET_DUR: 10,
            START_ON: 0,
            END_ON: 6,
          };
        }
      });
    }
    // Add possible Media Tracks
    manifest += "\n";
    for (let i = 0; i < opts.videoTracks.length; i++) {
      const vt = opts.videoTracks[i];
      let variantStr = "\n#EXT-X-STREAM-INF:";
      variantStr += `BANDWIDTH=${vt.bandwidth}`;
      variantStr += `,RESOLUTION=${vt.width}x${vt.height}`;
      variantStr += `,CODECS="${vt.codecs}"`;
      if (vt.frameRate) {
        variantStr += `,FRAME-RATE=${vt.frameRate}`;
      }
      if (vt.audio) {
        variantStr += `,AUDIO="${vt.audio}"`;
      }
      if (vt.subtitle) {
        variantStr += `,SUBTITLE="${vt.subtitle}"`;
      }
      // Add Variant URI
      variantStr += `\nlevel_${i}.m3u8`;
      manifest += variantStr;
      // Lastly
      if (this.liveStreamData && !this.liveStreamData[vt.bandwidth]) {
        this.liveStreamData[`video-${vt.bandwidth}`] = {
          MSEQ: 0,
          DSEQ: 0,
          TARGET_DUR: 10,
          START_ON: 0,
          END_ON: 6,
        };
      }
    }

    this.multiVariantM3u8 = manifest;
  }

  getMultiVariant(): string {
    return this.multiVariantM3u8;
  }
}
