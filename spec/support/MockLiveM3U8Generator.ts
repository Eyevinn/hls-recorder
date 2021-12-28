export interface IVideoTracks {
  bandwidth: number;
  width: number;
  height: number;
  codecs: string;
  frameRate?: number;
  audio?: string;
  subtitle?: string;
}

export interface IMultiVariantOptions {
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
export interface ILiveStreamPlaylistMetadata {
  VARIANT?: string;
  MSEQ: number;
  DSEQ: number;
  TARGET_DUR: number;
  START_ON: number;
  END_ON: number;
}
export enum EnumStreamType {
  "NONE" = 0,
  "EVENT" = 1,
  "LIVE" = 2,
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
  liveStreamData: { [key: string]: ILiveStreamPlaylistMetadata } | any;
  targetSegment: number;
  replacementString: string;

  constructor() {
    this.header = `#EXTM3U
#EXT-X-VERSION:7`;
    this.multiVariantM3u8 = "<Not Set>";
    this.targetSegment = -1;
    this.replacementString = "";
    this.liveStreamData = {};
  }

  shiftSegments(variant: string, num: number) {
    if (this.liveStreamData) {
      this.liveStreamData[variant].START_ON += num;
      this.liveStreamData[variant].MSEQ += num;
    }
  }

  pushSegments(variant: string, num: number) {
    if (this.liveStreamData) {
      this.liveStreamData[variant].END_ON += num;
    }
  }

  setInitPlaylistData(initData: any) {
    if (this.liveStreamData && Object.keys(this.liveStreamData).length > 0) {
      Object.keys(this.liveStreamData).forEach((variant) => {
        if (this.liveStreamData && this.liveStreamData[variant]) {
          this.liveStreamData[variant] = JSON.parse(JSON.stringify(initData));
        }
      });
    }
  }

  insertAt(data: string, segIdx: number) {
    this.targetSegment = segIdx;
    this.replacementString = data;
  }

  getMediaPlaylistM3U8(type: EnumStreamType, variant: string, useKey?: boolean, useMap?: boolean) {
    let data: ILiveStreamPlaylistMetadata;
    if (!this.liveStreamData) {
      return "Error";
    }
    data = this.liveStreamData[variant];
    let manifest = "";
    manifest += this.header;
    if (type === EnumStreamType.EVENT) {
      manifest += `\n#EXT-X-PLAYLIST-TYPE:EVENT`;
    }
    manifest += `\n#EXT-X-TARGETDURATION:${data.TARGET_DUR}`;
    manifest += `\n#EXT-X-DISCONTINUITY-SEQUENCE:${data.DSEQ}`;
    manifest += `\n#EXT-X-MEDIA-SEQUENCE:${data.MSEQ}`;

    if (useMap) {
      manifest += `\n#EXT-X-MAP:URI="mock-init.mp4"`;
    }
    if (useKey) {
      manifest += `\n#EXT-X-KEY:METHOD=AES-128,URI="mock-key.bin"`;
    }

    for (let i = data.START_ON; i < data.END_ON; i++) {
      if (this.targetSegment === i) {
        manifest += this.replacementString;
        break;
      }
      manifest += `\n#EXTINF:${data.TARGET_DUR}`;
      if (useMap) {
        manifest += `\n${variant}-seg_${i}.m4s`;
      } else {
        manifest += `\n${variant}-seg_${i}.ts`;
      }
    }

    return manifest;
  }

  setMultiVariant(opts: IMultiVariantOptions): void {
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
