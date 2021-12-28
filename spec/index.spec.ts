const nock = require("nock");
import { exitCode } from "process";
import { HLSRecorder, ISegments } from "..";
import { GenerateMediaM3U8 } from "../util/manifest_generator";
import {
  MockLiveM3U8Generator,
  ILiveStreamPlaylistMetadata,
  EnumStreamType,
  IMultiVariantOptions,
} from "./support/MockLiveM3U8Generator";

const mockBaseUri = "https://mock.mock.com/";
const mockLiveUri = "https://mock.mock.com/live/master.m3u8";
const tsNow = Date.now();
const vTracks = [
  {
    bandwidth: 500500,
    width: 640,
    height: 266,
    codecs: "avc1.42c00c",
  },
  {
    bandwidth: 700700,
    width: 1280,
    height: 534,
    codecs: "avc1.42c00c",
  },
];
const aTracks = [
  {
    groupId: "aac",
    language: "en",
    name: "English",
    default: true,
  },
  {
    groupId: "aac",
    language: "sv",
    name: "Svenska",
    default: false,
  },
];
const sTracks = [
  {
    groupId: "cc",
    language: "en",
    name: "English",
    default: false,
  },
];

describe("HLSRecorder", () => {
  beforeEach(() => {
    jasmine.clock().install();
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });
  // Test 1
  it("should record Live type HLS stream, and end recording when target duration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: IMultiVariantOptions = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 6, // last segement in playlist h as this index
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: 120,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
      // const variants = Object.keys(data.allPlaylistSegments["video"]);
      // const variantData = data.allPlaylistSegments["video"][variants[0]];
      // console.log(`Recorded Segments: ${JSON.stringify(variantData, null, 2)}`);
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const variants = Object.keys(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"]);
    variants.forEach((variant) => {
      const lastIndex =
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList.length - 1;
      // Check First Segment
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].index).toBe(
        1
      );
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].uri).toBe(
        `https://mock.mock.com/live/video-${variant}-seg_0.ts`
      );
      // Check Second-to-Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].index
      ).toBe(12);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].uri
      ).toBe(`https://mock.mock.com/live/video-${variant}-seg_11.ts`);
      // Check Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex].index
      ).toBe(null);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex].endlist
      ).toBe(true);
      // Bonus
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].mediaSeq).toBe(6); // Six Iterations Since Start...
    });
  });

  // Test 2
  it("should record Event type HLS stream, and end recording when #EXT-X-ENDLIST appears in HLS stream", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 15;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: IMultiVariantOptions = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 5, // last segement in playlist h as this index
    });
    mockHLSSource.insertAt("\n#EXT-X-ENDLIST", targetEndlistIndex); // will slap on an endlist tag at this seg index
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
      // const variants = Object.keys(data.allPlaylistSegments["video"]);
      // const variantData = data.allPlaylistSegments["video"][variants[0]];
      // console.log(`Recorded Segments: ${JSON.stringify(variantData, null, 2)}`);
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const variants = Object.keys(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"]);
    variants.forEach((variant) => {
      const lastIndex =
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList.length - 1;
      // Check First Segment
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].index).toBe(
        1
      );
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].uri).toBe(
        `https://mock.mock.com/live/video-${variant}-seg_0.ts`
      );
      // Check Second-to-Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].index
      ).toBe(targetEndlistIndex);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].uri
      ).toBe(`https://mock.mock.com/live/video-${variant}-seg_${targetEndlistIndex - 1}.ts`);
      // Check Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex].index
      ).toBe(null);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex].endlist
      ).toBe(true);
      // Bonus
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].mediaSeq).toBe(0); // Event stream is on the same mseq...
    });
  });

  // Test 3
  it("should record Live type HLS stream, with KEY tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 15;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: IMultiVariantOptions = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 6, // last segement in playlist h as this index
    });
    mockHLSSource.insertAt("#EXT-X-ENDLIST", targetEndlistIndex);

    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500", true);
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700", true);
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
      // const variants = Object.keys(data.allPlaylistSegments["video"]);
      // const variantData = data.allPlaylistSegments["video"][variants[0]];
      // console.log(`Recorded Segments: ${JSON.stringify(variantData, null, 2)}`);
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const variants = Object.keys(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"]);
    variants.forEach((variant) => {
      const lastIndex =
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList.length - 1;
      // Check First Segment
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].index).toBe(
        1
      );
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].uri).toBe(
        `https://mock.mock.com/live/video-${variant}-seg_0.ts`
      );
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].key).toEqual(
        {
          method: "AES-128",
          uri: "https://mock.mock.com/live/mock-key.bin",
          iv: null,
          format: null,
          formatVersions: null,
        }
      );
      // Check Second-to-Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].index
      ).toBe(targetEndlistIndex);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].uri
      ).toBe(`https://mock.mock.com/live/video-${variant}-seg_${targetEndlistIndex - 1}.ts`);
      // Check Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[targetEndlistIndex]
          .index
      ).toBe(null);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[targetEndlistIndex]
          .endlist
      ).toBe(true);
      // Bonus
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].mediaSeq).toBe(9);
    });
  });

  //Test 4
  it("should record Live type HLS stream, with MAP tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 20;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: IMultiVariantOptions = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 6, // last segement in playlist h as this index
    });
    mockHLSSource.insertAt("#EXT-X-ENDLIST", targetEndlistIndex);

    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(
          EnumStreamType.LIVE,
          "video-500500",
          false,
          true
        );
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(
          EnumStreamType.LIVE,
          "video-700700",
          false,
          true
        );
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
      // const variants = Object.keys(data.allPlaylistSegments["video"]);
      // const variantData = data.allPlaylistSegments["video"][variants[0]];
      // console.log(`Recorded Segments: ${JSON.stringify(variantData, null, 2)}`);
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const variants = Object.keys(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"]);
    variants.forEach((variant) => {
      const lastIndex =
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList.length - 1;
      // Check First Segment
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].index).toBe(
        1
      );
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].uri).toBe(
        `https://mock.mock.com/live/video-${variant}-seg_0.m4s`
      );
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[0].map).toEqual(
        {
          uri: "https://mock.mock.com/live/mock-init.mp4",
          byterange: null,
        }
      );
      // Check Second-to-Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].index
      ).toBe(targetEndlistIndex);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[lastIndex - 1].uri
      ).toBe(`https://mock.mock.com/live/video-${variant}-seg_${targetEndlistIndex - 1}.m4s`);
      // Check Last Segment
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[targetEndlistIndex]
          .index
      ).toBe(null);
      expect(
        LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].segList[targetEndlistIndex]
          .endlist
      ).toBe(true);
      // Bonus
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][variant].mediaSeq).toBe(14);
    });
  });

  //Test 5
  it("should record Live type HLS stream, with demuxed audio", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: IMultiVariantOptions = {
      videoTracks: vTracks,
      audioTracks: aTracks,
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 6, // last segement in playlist h as this index
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      })
      .get("/live/audio-aac_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "audio-aac_en");
        mockHLSSource.shiftSegments("audio-aac_en", 1);
        mockHLSSource.pushSegments("audio-aac_en", 1);
        return m3u8;
      })
      .get("/live/audio-aac_sv.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "audio-aac_sv");
        mockHLSSource.shiftSegments("audio-aac_sv", 1);
        mockHLSSource.pushSegments("audio-aac_sv", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: 120,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const audioVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["audio"];

    const bandwidths = Object.keys(videoVariants);
    const groups = Object.keys(audioVariants);

    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      //
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_11.ts`);
      //
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
    });

    groups.forEach((group) => {
      const langs = Object.keys(audioVariants[group]);
      langs.forEach((lang) => {
        const segList = audioVariants[group][lang].segList;
        const lastIdx = segList.length - 1;
        expect(segList[0].index).toBe(1);
        expect(segList[0].uri).toBe(`https://mock.mock.com/live/audio-${group}_${lang}-seg_0.ts`);
        //
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/audio-${group}_${lang}-seg_11.ts`
        );
        //
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });

  it("should record Live type HLS stream, with subtitles", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: IMultiVariantOptions = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: sTracks,
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 6, // last segement in playlist h as this index
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      })
      .get("/live/sub-cc_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "sub-cc_en");
        mockHLSSource.shiftSegments("sub-cc_en", 1);
        mockHLSSource.pushSegments("sub-cc_en", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: 120,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const subVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["subtitle"];

    const bandwidths = Object.keys(videoVariants);
    const groups = Object.keys(subVariants);

    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      //
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_11.ts`);
      //
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
    });

    groups.forEach((group) => {
      const langs = Object.keys(subVariants[group]);
      langs.forEach((lang) => {
        const segList = subVariants[group][lang].segList;
        const lastIdx = segList.length - 1;
        expect(segList[0].index).toBe(1);
        expect(segList[0].uri).toBe(`https://mock.mock.com/live/sub-${group}_${lang}-seg_0.ts`);
        //
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/sub-${group}_${lang}-seg_11.ts`
        );
        //
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });

  it("should record Live type HLS stream, with demuxed audio and subtitles", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: IMultiVariantOptions = {
      videoTracks: vTracks,
      audioTracks: aTracks,
      subtitleTracks: sTracks,
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 6, // last segement in playlist h as this index
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      })
      .get("/live/audio-aac_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "audio-aac_en");
        mockHLSSource.shiftSegments("audio-aac_en", 1);
        mockHLSSource.pushSegments("audio-aac_en", 1);
        return m3u8;
      })
      .get("/live/audio-aac_sv.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "audio-aac_sv");
        mockHLSSource.shiftSegments("audio-aac_sv", 1);
        mockHLSSource.pushSegments("audio-aac_sv", 1);
        return m3u8;
      })
      .get("/live/sub-cc_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "sub-cc_en");
        mockHLSSource.shiftSegments("sub-cc_en", 1);
        mockHLSSource.pushSegments("sub-cc_en", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: 120,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const audioVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["audio"];
    const subVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["subtitle"];

    const bandwidths = Object.keys(videoVariants);
    const aGroups = Object.keys(audioVariants);
    const sGroups = Object.keys(subVariants);

    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      //
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_11.ts`);
      //
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
    });

    aGroups.forEach((group) => {
      const langs = Object.keys(audioVariants[group]);
      langs.forEach((lang) => {
        const segList = audioVariants[group][lang].segList;
        const lastIdx = segList.length - 1;
        expect(segList[0].index).toBe(1);
        expect(segList[0].uri).toBe(`https://mock.mock.com/live/audio-${group}_${lang}-seg_0.ts`);
        //
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/audio-${group}_${lang}-seg_11.ts`
        );
        //
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });

    sGroups.forEach((group) => {
      const langs = Object.keys(subVariants[group]);
      langs.forEach((lang) => {
        const segList = subVariants[group][lang].segList;
        const lastIdx = segList.length - 1;
        expect(segList[0].index).toBe(1);
        expect(segList[0].uri).toBe(`https://mock.mock.com/live/sub-${group}_${lang}-seg_0.ts`);
        //
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/sub-${group}_${lang}-seg_11.ts`
        );
        //
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });

  it("should record Live type HLS stream, obtain cookies if any and pass cookieJar in 'mseq-increment' event", async () => {});

  it("should record Live type HLS stream, with a sliding window if set", async () => {});

  it("should record Live type HLS stream, ----- ", async () => {});
});

/**
 * 
      let mm = await GenerateMediaM3U8(500500, {
      targetDuration: 10,
      mseq: 16,
      allSegments: LAST_RETURNED_EVENT_DATA.allPlaylistSegments,
    });
    console.log(mm);


    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      })
      .get("/live/audio-aac_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "audio-aac_en");
        mockHLSSource.shiftSegments("audio-aac_en", 1);
        mockHLSSource.pushSegments("audio-aac_en", 1);
        return m3u8;
      })
      .get("/live/audio-aac_sv.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "audio-aac_sv");
        mockHLSSource.shiftSegments("audio-aac_sv", 1);
        mockHLSSource.pushSegments("audio-aac_sv", 1);
        return m3u8;
      })
      .get("/live/sub-cc_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "sub-cc_en");
        mockHLSSource.shiftSegments("sub-cc_en", 1);
        mockHLSSource.pushSegments("sub-cc_en", 1);
        return m3u8;
      });
 */
