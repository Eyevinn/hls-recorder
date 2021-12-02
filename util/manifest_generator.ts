import { IRecData } from "./handlers";
import packageJson from "../package.json";
import { Segment } from "..";
const debug = require("debug")("hls-recorder");

// Helper functions
const m3u8Header = () => {
  let m3u8 = "";
  m3u8 += `## Created with Eyevinn HLS Recorder library (version=${packageJson.version})\n`;
  m3u8 += "##    https://www.npmjs.com/package/@eyevinn/hls-recorder\n";
  return m3u8;
};

const _daterangeAttribute = (key: string, attr: number): string => {
  if (key === "planned-duration" || key === "duration") {
    return key.toUpperCase() + "=" + `${attr.toFixed(3)}`;
  } else {
    return key.toUpperCase() + "=" + `"${attr}"`;
  }
};

const _segmentToString = (seg: Segment): string => {
  let m3u8 = "";
  if (seg.endlist) {
    m3u8 += "#EXT-X-ENDLIST\n";
  }
  if (seg.map) {
    m3u8 += `#EXT-X-MAP:URI="${seg.map.uri}"`;
    if (seg.map.byterange) {
      m3u8 += `,BYTERANGE=${seg.map.byterange}`;
    }
    m3u8 += "\n";
  }
  if (seg.discontinuity) {
    m3u8 += "#EXT-X-DISCONTINUITY\n";
  }
  if (seg.cue) {
    if (seg.cue.in) {
      m3u8 += "#EXT-X-CUE-IN" + "\n";
    }
    if (seg.cue.out) {
      if (seg.cue.scteData) {
        m3u8 += "#EXT-OATCLS-SCTE35:" + seg.cue.scteData + "\n";
      }
      if (seg.cue.assetData) {
        m3u8 += "#EXT-X-ASSET:" + seg.cue.assetData + "\n";
      }
      m3u8 += "#EXT-X-CUE-OUT:DURATION=" + seg.cue.duration + "\n";
    }
    if (seg.cue.cont) {
      if (seg.cue.scteData) {
        m3u8 +=
          "#EXT-X-CUE-OUT-CONT:ElapsedTime=" +
          seg.cue.cont +
          ",Duration=" +
          seg.cue.duration +
          ",SCTE35=" +
          seg.cue.scteData +
          "\n";
      } else {
        m3u8 += "#EXT-X-CUE-OUT-CONT:" + seg.cue.cont + "/" + seg.cue.duration + "\n";
      }
    }
  }
  if (seg.datetime) {
    m3u8 += `#EXT-X-PROGRAM-DATE-TIME:${seg.datetime}\n`;
  }
  if (seg.daterange) {
    const dateRangeAttributes = Object.keys(seg.daterange)
      .map((key) => _daterangeAttribute(key, seg.daterange[key]))
      .join(",");
    if (!seg.datetime && seg.daterange["start-date"]) {
      m3u8 += "#EXT-X-PROGRAM-DATE-TIME:" + seg.daterange["start-date"] + "\n";
    }
    m3u8 += "#EXT-X-DATERANGE:" + dateRangeAttributes + "\n";
  }
  if (seg.key) {
    m3u8 += `#EXT-X-KEY:METHOD=${seg.key.method}`;
    if (seg.key.uri) {
      m3u8 += `,URI="${seg.key.uri}"`;
    }
    if (seg.key.iv) {
      m3u8 += `,IV=${seg.key.iv}`;
    }
    if (seg.key.format) {
      m3u8 += `,KEYFORMAT="${seg.key.format}"`;
    }
    if (seg.key.formatVersions) {
      m3u8 += `,KEYFORMATVERSIONS="${seg.key.formatVersions}"`;
    }
    m3u8 += "\n";
  }
  if (seg.uri) {
    m3u8 += "#EXTINF:" + seg.duration?.toFixed(3) + ",\n";
    m3u8 += seg.uri + "\n";
  }
  return m3u8;
};

//   .---------------------.
//===| GENERATOR FUNCTIONS |===>
//   '---------------------'

// For Video
export async function GenerateMediaM3U8(BW: number, OPTIONS: IRecData): Promise<string | null> {
  if (BW === null) {
    throw new Error("No bandwidth provided");
  }

  debug(`[m3u8generator]: Client requesting manifest for bw=(${BW})`);

  //  DO NOT GENERATE MANIFEST CASE: Not yet started gathering segs of all variants.
  if (Object.keys(OPTIONS.allSegments["video"]).length === 0) {
    debug(
      `[m3u8generator]: Cannot Generate Manifest! Not yet collected ANY segments from Source...`
    );
    return null;
  }

  //  DO NOT GENERATE MANIFEST CASE: In the middle of gathering segs of all variants.
  if (!Object.keys(OPTIONS.allSegments["video"]).length) {
    let segAmounts = Object.keys(OPTIONS.allSegments["video"]).map(
      (bw) => OPTIONS.allSegments["video"][bw].segList.length
    );
    if (!segAmounts.every((val, i, arr) => val === arr[0])) {
      debug(
        `[m3u8generator]: Cannot Generate Manifest! Not yet collected ALL segments from Source...`
      );
      return null;
    }
  }

  debug(`[m3u8generator]: Started Generating the Manifest with Mseq:[${OPTIONS.mseq}]...`);

  let m3u8 = "#EXTM3U\n";
  m3u8 += "#EXT-X-VERSION:6\n";
  m3u8 += m3u8Header();
  m3u8 += "#EXT-X-PLAYLIST-TYPE:EVENT\n";
  m3u8 += "#EXT-X-INDEPENDENT-SEGMENTS\n";
  m3u8 += "#EXT-X-TARGETDURATION:" + OPTIONS.targetDuration + "\n";
  m3u8 += "#EXT-X-MEDIA-SEQUENCE:" + OPTIONS.mseq + "\n";
  if (OPTIONS.dseq !== undefined) {
    m3u8 += "#EXT-X-DISCONTINUITY-SEQUENCE:" + OPTIONS.dseq + "\n";
    // Add support later, live streams might use recorder with ad breaks?
  }
  for (let i = 0; i < OPTIONS.allSegments["video"][BW].segList.length; i++) {
    const seg = OPTIONS.allSegments["video"][BW].segList[i];
    m3u8 += _segmentToString(seg);
  }
  debug(`[m3u8generator]: Manifest Generation Complete!`);
  return m3u8;
}

// For Audio
export async function GenerateAudioM3U8(
  GROUP: string,
  LANG: string,
  OPTIONS: IRecData
): Promise<string | null> {
  if (!GROUP || !LANG) {
    throw new Error(
      `No ${!GROUP ? "Group ID" : ""} ${!GROUP && !LANG ? "nor" : ""} ${
        !LANG ? "Language" : ""
      } provided`
    );
  }

  debug(`[m3u8generator]: Client requesting manifest for audio track=(${GROUP}_${LANG})`);
  //  DO NOT GENERATE MANIFEST CASE: Not yet started gathering segs of all variants.
  if (Object.keys(OPTIONS.allSegments["audio"]).length === 0) {
    debug(
      `[m3u8generator]: Cannot Generate Manifest! Not yet collected ANY segments from Source...`
    );
    return null;
  }
  //  DO NOT GENERATE MANIFEST CASE: Node is in the middle of gathering segs of all variants.
  if (!Object.keys(OPTIONS.allSegments["audio"]).length) {
    let groups = Object.keys(OPTIONS.allSegments["audio"]);
    for (let i = 0; i < groups.length; i++) {
      let segAmounts = Object.keys(OPTIONS.allSegments["audio"][groups[i]]).map(
        (lang) => OPTIONS.allSegments["audio"][groups[i]][lang].segList.length
      );
      if (!segAmounts.every((val, i, arr) => val === arr[0])) {
        debug(
          `[m3u8generator]: Cannot Generate Manifest! Not yet collected ALL segments from Source...`
        );
        return null;
      }
    }
  }

  debug(`[m3u8generator]: Started Generating the Audio Manifest with Mseq:[${OPTIONS.mseq}]...`);

  let m3u8 = "#EXTM3U\n";
  m3u8 += "#EXT-X-VERSION:6\n";
  m3u8 += m3u8Header();
  m3u8 += "#EXT-X-PLAYLIST-TYPE:EVENT\n";
  m3u8 += "#EXT-X-INDEPENDENT-SEGMENTS\n";
  m3u8 += "#EXT-X-TARGETDURATION:" + OPTIONS.targetDuration + "\n";
  m3u8 += "#EXT-X-MEDIA-SEQUENCE:" + OPTIONS.mseq + "\n";
  if (OPTIONS.dseq !== undefined) {
    m3u8 += "#EXT-X-DISCONTINUITY-SEQUENCE:" + OPTIONS.dseq + "\n";
    // Add support later, live streams might use recorder with ad breaks?
  }

  for (let i = 0; i < OPTIONS.allSegments["audio"][GROUP][LANG].segList.length; i++) {
    const seg = OPTIONS.allSegments["audio"][GROUP][LANG].segList[i];
    m3u8 += _segmentToString(seg);
  }
  debug(`[m3u8generator]: Audio Manifest Generation Complete!`);
  return m3u8;
}

// For Subtitles
export async function GenerateSubtitleM3U8(
  GROUP: string,
  LANG: string,
  OPTIONS: IRecData
): Promise<string | null> {
  if (!GROUP || !LANG) {
    throw new Error(
      `No ${!GROUP ? "Group ID" : ""} ${!GROUP && !LANG ? "nor" : ""} ${
        !LANG ? "Language" : ""
      } provided`
    );
  }

  debug(`[m3u8generator]: Client requesting manifest for subtitle track=(${GROUP}_${LANG})`);
  //  DO NOT GENERATE MANIFEST CASE: Not yet started gathering segs of all variants.
  if (Object.keys(OPTIONS.allSegments["subtitle"]).length === 0) {
    debug(
      `[m3u8generator]: Cannot Generate Manifest! Not yet collected ANY segments from Source...`
    );
    return null;
  }
  //  DO NOT GENERATE MANIFEST CASE: Node is in the middle of gathering segs of all variants.
  if (!Object.keys(OPTIONS.allSegments["subtitle"]).length) {
    let groups = Object.keys(OPTIONS.allSegments["subtitle"]);
    for (let i = 0; i < groups.length; i++) {
      let segAmounts = Object.keys(OPTIONS.allSegments["subtitle"][groups[i]]).map(
        (lang) => OPTIONS.allSegments["subtitle"][groups[i]][lang].segList.length
      );
      if (!segAmounts.every((val, i, arr) => val === arr[0])) {
        debug(
          `[m3u8generator]: Cannot Generate Manifest! Not yet collected ALL segments from Source...`
        );
        return null;
      }
    }
  }

  debug(`[m3u8generator]: Started Generating the Subtitle Manifest with Mseq:[${OPTIONS.mseq}]...`);

  let m3u8 = "#EXTM3U\n";
  m3u8 += "#EXT-X-VERSION:6\n";
  m3u8 += m3u8Header();
  m3u8 += "#EXT-X-PLAYLIST-TYPE:EVENT\n";
  m3u8 += "#EXT-X-INDEPENDENT-SEGMENTS\n";
  m3u8 += "#EXT-X-TARGETDURATION:" + OPTIONS.targetDuration + "\n";
  m3u8 += "#EXT-X-MEDIA-SEQUENCE:" + OPTIONS.mseq + "\n";
  if (OPTIONS.dseq !== undefined) {
    m3u8 += "#EXT-X-DISCONTINUITY-SEQUENCE:" + OPTIONS.dseq + "\n";
    // Add support later, live streams might use recorder with ad breaks?
  }

  for (let i = 0; i < OPTIONS.allSegments["subtitle"][GROUP][LANG].segList.length; i++) {
    const seg = OPTIONS.allSegments["subtitle"][GROUP][LANG].segList[i];
    m3u8 += _segmentToString(seg);
  }
  debug(`[m3u8generator]: Subtitle Manifest Generation Complete!`);
  return m3u8;
}

// For Master
export async function GenerateMasterM3U8(m3u: any): Promise<string | null> {
  debug(
    `[m3u8generator]: Started Generating the Master Manifest...[${m3u.items.StreamItem.length}]`
  );

  let m3u8 = "#EXTM3U\n";
  m3u8 += "#EXT-X-VERSION:6\n";
  m3u8 += m3u8Header();
  m3u8 += `\n## Media Tracks \n`;
  for (let i = 0; i < m3u.items.StreamItem.length; i++) {
    const streamItem = m3u.items.StreamItem[i];
    let bw = null;
    let resolution = null;
    let codecs = null;
    let frameRate = null;
    let subs = null;
    let audio = null;
    if (streamItem.get("bandwidth")) {
      bw = streamItem.get("bandwidth");
    }
    if (streamItem.get("resolution")) {
      resolution = streamItem.get("resolution")[0] + "x" + streamItem.get("resolution")[1];
    }
    if (streamItem.get("codecs")) {
      codecs = streamItem.get("codecs");
    }
    if (streamItem.get("frame-rate")) {
      frameRate = streamItem.get("frame-rate");
    }
    if (streamItem.attributes.attributes["audio"]) {
      audio = streamItem.attributes.attributes["audio"];
    }
    if (streamItem.attributes.attributes["subtitles"]) {
      subs = streamItem.attributes.attributes["subtitles"];
    }
    m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=${bw}`;
    if (resolution) {
      m3u8 += `,RESOLUTION=${resolution}`;
    }
    if (codecs) {
      m3u8 += `,CODECS="${codecs}"`;
    }
    if (frameRate) {
      m3u8 += `,FRAME-RATE=${frameRate}`;
    }
    if (audio) {
      m3u8 += `,AUDIO="${audio}"`;
    }
    if (subs) {
      m3u8 += `,SUBTITLES="${subs}"`;
    }
    m3u8 += "\n";
    m3u8 += `master${bw}.m3u8\n`; // new playlist url
  }

  // Add Media Items
  let audioItems = m3u.items.MediaItem.filter((item: any) => {
    return item.attributes.attributes.type === "AUDIO";
  });
  let subtitleItems = m3u.items.MediaItem.filter((item: any) => {
    return item.attributes.attributes.type === "SUBTITLES";
  });

  if (audioItems.length > 0) {
    m3u8 += `\n## Audio Tracks \n`;
  }

  for (let i = 0; i < audioItems.length; i++) {
    const audioItem = audioItems[i];
    let groupId = null;
    let language = null;
    let name = null;

    m3u8 += `#EXT-X-MEDIA:TYPE=AUDIO`;
    if (audioItem.get("group-id")) {
      groupId = audioItem.get("group-id");
      m3u8 += `,GROUP-ID="${groupId}"`;
    }
    if (audioItem.get("language")) {
      language = audioItem.get("language");
      m3u8 += `,LANGUAGE="${language}"`;
    }
    if (audioItem.get("name")) {
      name = audioItem.get("name");
      m3u8 += `,NAME="${name}"`;
    }
    if (audioItem.get("channels")) {
      let channels = audioItem.get("channels");
      m3u8 += `,CHANNELS="${channels}"`;
    } else {
      m3u8 += `,CHANNELS="2"`;
    }
    if (audioItem.get("default")) {
      m3u8 += `,DEFAULT=YES`;
    } else {
      m3u8 += `,DEFAULT=NO`;
    }
    if (audioItem.get("autoselect")) {
      m3u8 += `,AUTOSELECT=YES`;
    } else {
      m3u8 += `,AUTOSELECT=NO`;
    }
    m3u8 += `,URI="master-audiotrack_${groupId}_${language}.m3u8"\n`;
  }

  if (subtitleItems.length > 0) {
    m3u8 += `\n## Subtitle Tracks \n`;
  }

  for (let i = 0; i < subtitleItems.length; i++) {
    const subtitleItem = subtitleItems[i];
    let groupId = null;
    let language = null;
    let name = null;

    m3u8 += `#EXT-X-MEDIA:TYPE=SUBTITLES`;
    if (subtitleItem.get("group-id")) {
      groupId = subtitleItem.get("group-id");
      m3u8 += `,GROUP-ID="${groupId}"`;
    }
    if (subtitleItem.get("language")) {
      language = subtitleItem.get("language");
      m3u8 += `,LANGUAGE="${language}"`;
    }
    if (subtitleItem.get("name")) {
      name = subtitleItem.get("name");
      m3u8 += `,NAME="${name}"`;
    }
    if (subtitleItem.get("forced")) {
      m3u8 += `,FORCED=YES`;
    } else {
      m3u8 += `,FORCED=NO`;
    }
    if (subtitleItem.get("default")) {
      m3u8 += `,DEFAULT=YES`;
    } else {
      m3u8 += `,DEFAULT=NO`;
    }
    if (subtitleItem.get("autoselect")) {
      m3u8 += `,AUTOSELECT=YES`;
    } else {
      m3u8 += `,AUTOSELECT=NO`;
    }
    m3u8 += `,URI="master-subtrack_${groupId}_${language}.m3u8"\n`;
  }
  debug(`[m3u8generator]: Master Manifest Generation Complete!`);
  return m3u8;
}
