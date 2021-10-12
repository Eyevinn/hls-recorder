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
exports.GenerateAudioM3U8 = exports.GenerateMediaM3U8 = void 0;
const debug = require("debug")("recorder-m3u8generator");
function GenerateMediaM3U8(BW, OPTIONS) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        if (BW === null) {
            throw new Error("No bandwidth provided");
        }
        debug(`Client requesting manifest for bw=(${BW})`);
        //  DO NOT GENERATE MANIFEST CASE: Not yet started gathering segs of all variants.
        if (Object.keys(OPTIONS.allSegments["video"]).length === 0) {
            debug(`Cannot Generate Manifest! Not yet collected ANY segments from Source...`);
            return null;
        }
        //  DO NOT GENERATE MANIFEST CASE: In the middle of gathering segs of all variants.
        if (!Object.keys(OPTIONS.allSegments["video"]).length) {
            let segAmounts = Object.keys(OPTIONS.allSegments["video"]).map((bw) => OPTIONS.allSegments["video"][bw].segList.length);
            if (!segAmounts.every((val, i, arr) => val === arr[0])) {
                debug(`Cannot Generate Manifest! Not yet collected ALL segments from Source...`);
                return null;
            }
        }
        debug(`Started Generating the Manifest with Mseq:[${OPTIONS.mseq}]...`);
        let m3u8 = "#EXTM3U\n";
        m3u8 += "#EXT-X-PLAYLIST-TYPE:EVENT\n";
        m3u8 += "#EXT-X-VERSION:6\n";
        m3u8 += "## Created with Eyevinn HLS Recorder package\n";
        m3u8 += "#EXT-X-INDEPENDENT-SEGMENTS\n";
        m3u8 += "#EXT-X-TARGETDURATION:" + OPTIONS.targetDuration + "\n";
        m3u8 += "#EXT-X-MEDIA-SEQUENCE:" + OPTIONS.mseq + "\n";
        if (OPTIONS.dseq) {
            m3u8 += "#EXT-X-DISCONTINUITY-SEQUENCE:" + OPTIONS.dseq + "\n";
            // Add support later, live streams might use recorder with ad breaks?
        }
        for (let i = 0; i < OPTIONS.allSegments["video"][BW].segList.length; i++) {
            const seg = OPTIONS.allSegments["video"][BW].segList[i];
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
                    }
                    else {
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
                    .map((key) => _daterangeAttribute(key, seg.daterange[key]))
                    .join(",");
                if (seg.daterange["start-date"]) {
                    m3u8 +=
                        "#EXT-X-PROGRAM-DATE-TIME:" + seg.daterange["start-date"] + "\n";
                }
                m3u8 += "#EXT-X-DATERANGE:" + dateRangeAttributes + "\n";
            }
            if (seg.uri) {
                m3u8 += "#EXTINF:" + ((_a = seg.duration) === null || _a === void 0 ? void 0 : _a.toFixed(3)) + ",\n";
                m3u8 += seg.uri + "\n";
            }
        }
        debug(`Manifest Generation Complete!`);
        return m3u8;
    });
}
exports.GenerateMediaM3U8 = GenerateMediaM3U8;
function GenerateAudioM3U8(GROUP, LANG, OPTIONS) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        if (!GROUP || !LANG) {
            throw new Error(`No ${!GROUP ? "Group ID" : ""} ${!GROUP && !LANG ? "nor" : ""} ${!LANG ? "Language" : ""} provided`);
        }
        debug(`Client requesting manifest for audio track=(${GROUP}_${LANG})`);
        //  DO NOT GENERATE MANIFEST CASE: Not yet started gathering segs of all variants.
        if (Object.keys(OPTIONS.allSegments["audio"]).length === 0) {
            debug(`Cannot Generate Manifest! Not yet collected ANY segments from Source...`);
            return null;
        }
        //  DO NOT GENERATE MANIFEST CASE: Node is in the middle of gathering segs of all variants.
        if (!Object.keys(OPTIONS.allSegments["audio"]).length) {
            let groups = Object.keys(OPTIONS.allSegments["audio"]);
            for (let i = 0; i < groups.length; i++) {
                let segAmounts = Object.keys(OPTIONS.allSegments["audio"][groups[i]]).map((lang) => OPTIONS.allSegments["audio"][groups[i]][lang].segList.length);
                if (!segAmounts.every((val, i, arr) => val === arr[0])) {
                    debug(`Cannot Generate Manifest! Not yet collected ALL segments from Source...`);
                    return null;
                }
            }
        }
        debug(`Started Generating the Manifest with Mseq:[${OPTIONS.mseq}]...`);
        let m3u8 = "#EXTM3U\n";
        m3u8 += "#EXT-X-PLAYLIST-TYPE:EVENT\n";
        m3u8 += "#EXT-X-VERSION:6\n";
        m3u8 += "## Created with Eyevinn HLS Recorder package\n";
        m3u8 += "#EXT-X-INDEPENDENT-SEGMENTS\n";
        m3u8 += "#EXT-X-TARGETDURATION:" + OPTIONS.targetDuration + "\n";
        m3u8 += "#EXT-X-MEDIA-SEQUENCE:" + OPTIONS.mseq + "\n";
        if (OPTIONS.dseq) {
            m3u8 += "#EXT-X-DISCONTINUITY-SEQUENCE:" + OPTIONS.dseq + "\n";
            // Add support later, live streams might use recorder with ad breaks?
        }
        for (let i = 0; i < OPTIONS.allSegments["audio"][GROUP][LANG].segList.length; i++) {
            const seg = OPTIONS.allSegments["audio"][GROUP][LANG].segList[i];
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
                    }
                    else {
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
                    .map((key) => _daterangeAttribute(key, seg.daterange[key]))
                    .join(",");
                if (seg.daterange["start-date"]) {
                    m3u8 +=
                        "#EXT-X-PROGRAM-DATE-TIME:" + seg.daterange["start-date"] + "\n";
                }
                m3u8 += "#EXT-X-DATERANGE:" + dateRangeAttributes + "\n";
            }
            if (seg.uri) {
                m3u8 += "#EXTINF:" + ((_a = seg.duration) === null || _a === void 0 ? void 0 : _a.toFixed(3)) + ",\n";
                m3u8 += seg.uri + "\n";
            }
        }
        debug(`Manifest Generation Complete!`);
        return m3u8;
    });
}
exports.GenerateAudioM3U8 = GenerateAudioM3U8;
function _daterangeAttribute(key, attr) {
    if (key === "planned-duration" || key === "duration") {
        return key.toUpperCase() + "=" + `${attr.toFixed(3)}`;
    }
    else {
        return key.toUpperCase() + "=" + `"${attr}"`;
    }
}
//# sourceMappingURL=manifest_generator.js.map