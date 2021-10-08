import { ISegments } from "../index";
const debug = require("debug")("recorder-m3u8generator");

export async function GenerateMediaM3U8(
  BW: number,
  MSEQ: number,
  TARGET_DURATION: number,
  SEGMENTS: ISegments
) {
  if (BW === null) {
    throw new Error("No bandwidth provided");
  }

  debug(`Client requesting manifest for bw=(${BW})`);

  //  DO NOT GENERATE MANIFEST CASE: Node is in the middle of gathering segs of all variants.
  if (!Object.keys(SEGMENTS["video"]).length) {
    let segAmounts = Object.keys(SEGMENTS["video"]).map(
      (bw) => SEGMENTS["video"][bw].segList.length
    );
    if (!segAmounts.every((val, i, arr) => val === arr[0])) {
      debug(
        `Cannot Generate Manifest! Not yet collected ALL segments from Source...`
      );
      return null;
    }
  }

  debug(`Started Generating the Manifest File:[${MSEQ}]...`);

  let m3u8 = "#EXTM3U\n";
  m3u8 += "#EXT-X-PLAYLIST-TYPE:EVENT\n";
  m3u8 += "#EXT-X-VERSION:6\n";
  m3u8 += "## Created with Eyevinn HLS Recorder package\n";
  m3u8 += "#EXT-X-INDEPENDENT-SEGMENTS\n";
  m3u8 += "#EXT-X-TARGETDURATION:" + TARGET_DURATION + "\n";
  m3u8 += "#EXT-X-MEDIA-SEQUENCE:" + MSEQ + "\n";
  //m3u8 += "#EXT-X-DISCONTINUITY-SEQUENCE:" + this.discSeqCount + "\n"; // Add support later, live streams might use recorder with ad breaks?
  for (let i = 0; i < SEGMENTS["video"][BW].segList.length; i++) {
    const seg = SEGMENTS["video"][BW].segList[i];
    if (seg.endlist) {
      m3u8 += "#EXT-X-ENDLIST\n";
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
          m3u8 +=
            "#EXT-X-CUE-OUT-CONT:" +
            seg.cue.cont +
            "/" +
            seg.cue.duration +
            "\n";
        }
      }
    }
    if (seg.daterange) {
      const dateRangeAttributes = Object.keys(seg.daterange)
        .map((key) => daterangeAttribute(key, seg.daterange[key]))
        .join(",");
      if (seg.daterange["start-date"]) {
        m3u8 +=
          "#EXT-X-PROGRAM-DATE-TIME:" + seg.daterange["start-date"] + "\n";
      }
      m3u8 += "#EXT-X-DATERANGE:" + dateRangeAttributes + "\n";
    }
    if (seg.uri) {
      m3u8 += "#EXTINF:" + seg.duration?.toFixed(3) + ",\n";
      m3u8 += seg.uri + "\n";
    }
  }
  debug(`Manifest Generation Complete!`);
  return m3u8;
}

const daterangeAttribute = (key: string, attr: number) => {
  if (key === "planned-duration" || key === "duration") {
    return key.toUpperCase() + "=" + `${attr.toFixed(3)}`;
  } else {
    return key.toUpperCase() + "=" + `"${attr}"`;
  }
};
