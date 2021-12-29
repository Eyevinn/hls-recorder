const nock = require("nock");
import { HLSRecorder, IMseqIncrementEventPayload, ISegments, PlaylistType } from "..";
import {
  MockLiveM3U8Generator,
  EnumStreamType,
  ISetMultiVariantInput,
  ISetInitPlaylistDataInput,
} from "./support/MockLiveM3U8Generator";

const mockBaseUri = "https://mock.mock.com/";
const mockLiveUri = "https://mock.mock.com/live/master.m3u8";
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

// HLSRecorder: BASE
describe("HLSRecorder", () => {
  let mockHLSSource: MockLiveM3U8Generator;
  beforeEach(() => {
    jasmine.clock().install();
    mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
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
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });
  it("should record Live type HLS stream, and end recording when target duration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: IMseqIncrementEventPayload | any;
    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: 120,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: IMseqIncrementEventPayload) => {
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

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      //
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${lastIdx - 1}.ts`
      );
      //
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(6);
    });
  });
  it("should record Event type HLS stream, and end recording when target duration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    nock.cleanAll();
    const _mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    _mockHLSSource.setMultiVariant(config);
    _mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 6, // last segement in playlist h as this index
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, _mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-500500");
        _mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-700700");
        _mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: 200,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: IMseqIncrementEventPayload) => {
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      //
      expect(segList[lastIdx - 1].index).toBe(20);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${lastIdx - 1}.ts`
      );
      //
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(0);
    });
  });
  it("should record VOD type HLS stream, and end recording when target duration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: IMseqIncrementEventPayload | any;
    nock.cleanAll();
    const _mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    _mockHLSSource.setMultiVariant(config);
    _mockHLSSource.setInitPlaylistData({
      MSEQ: 1,
      DSEQ: 0,
      TARGET_DUR: 10, // duration for all segments in playlist
      START_ON: 0, // top segment in playlist has this index
      END_ON: 16, // last segement in playlist h as this index
    });
    _mockHLSSource.insertAt({
      replacementString: `#EXT-X-ENDLIST`,
      targetSegmentIndex: 16,
      stopAfter: true,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, _mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-500500");
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-700700");
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: 120,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: IMseqIncrementEventPayload) => {
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      //
      expect(segList[lastIdx - 1].index).toBe(16);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${lastIdx - 1}.ts`
      );
      //
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(1);
    });
  });
  //Test 9
  it("should record Live type HLS stream, with a sliding window if set", async () => {
    let LAST_RETURNED_EVENT_DATA: IMseqIncrementEventPayload | any;
    const targetEndlistIndex = 100;
    // Mock Source Becomming a VOD,
    // will slap on an endlist tag at this seg index
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
      windowSize: 60,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: IMseqIncrementEventPayload) => {
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      // Check First Segment
      expect(segList[0].index).toBe(targetEndlistIndex - 5);
      expect(segList[0].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 5 - 1}.ts`
      );
      // Check Second-to-Last Segment
      expect(segList[lastIdx - 1].index).toBe(targetEndlistIndex);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      // Check Last Segment
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(
        targetEndlistIndex - 5 - 1
      ); // Event stream is on the same mseq...
    });
  });
  it("should record Live type HLS stream, and if no window size is set, it should still slide according to default window size", async () => {
    let LAST_RETURNED_EVENT_DATA: IMseqIncrementEventPayload | any;
    const targetEndlistIndex = 200;
    const DEFAULT_MAX_WINDOW_SIZE = 5 * 60;
    // Mock Source Becomming a VOD,
    // will slap on an endlist tag at this seg index
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
      windowSize: -1,
      vod: true,
    });
    recorder.on("mseq-increment", async (data: IMseqIncrementEventPayload) => {
      LAST_RETURNED_EVENT_DATA = data;
    });
    recorder.on("error", (err: any) => {
      throw new Error("Something Bad Happend (>.<)" + err);
    });

    spyOn(recorder, "_timer").and.callFake(() => Promise.resolve());
    await recorder.start();

    const videoVariants = LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"];
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList.length).toBe(DEFAULT_MAX_WINDOW_SIZE / 10 + 1);
      // Check First Segment
      expect(segList[0].index).toBe(171);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_${170}.ts`);
      // Check Second-to-Last Segment
      expect(segList[lastIdx - 1].index).toBe(targetEndlistIndex);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      // Check Last Segment
      expect(segList[lastIdx].index).toBe(null);
      expect(segList[lastIdx].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(
        targetEndlistIndex - 5 - 1
      );
    });
  });
});

// HLSRecorder: ENCRYPTED
describe("HLSRecorder, when source is encrypted,", () => {
  let mockHLSSource: MockLiveM3U8Generator;
  beforeEach(() => {
    jasmine.clock().install();
    mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
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
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500", {
          keyString: `#EXT-X-KEY:METHOD=AES-128,URI="mock-key.bin",IV=5432554205,KEYFORMAT="mock",KEYFORMATVERSIONS="1/2/5"`,
        });
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700", {
          keyString: `#EXT-X-KEY:METHOD=AES-128,URI="mock-key.bin",IV=5432554205,KEYFORMAT="mock",KEYFORMATVERSIONS="1/2/5"`,
        });
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });
  it("should record Live type HLS stream, and handle #EXT-X-KEY tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 15;
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      expect(segList[0].key).toEqual({
        method: "AES-128",
        uri: "https://mock.mock.com/live/mock-key.bin",
        iv: "5432554205",
        format: "mock",
        formatVersions: "1/2/5",
      });
      expect(segList[lastIdx - 1].index).toBe(15);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(9);
    });
  });
  it("should record Event type HLS stream, and handle #EXT-X-KEY tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    nock.cleanAll();
    const targetEndlistIndex = 15;
    const _mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    _mockHLSSource.setMultiVariant(config);
    const input: ISetInitPlaylistDataInput = {
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
    };
    _mockHLSSource.setInitPlaylistData(input);
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, _mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-500500", {
          keyString: `#EXT-X-KEY:METHOD=AES-128,URI="mock-key.bin",IV=5432554205,KEYFORMAT="mock",KEYFORMATVERSIONS="1/2/5"`,
        });
        _mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-700700", {
          keyString: `#EXT-X-KEY:METHOD=AES-128,URI="mock-key.bin",IV=5432554205,KEYFORMAT="mock",KEYFORMATVERSIONS="1/2/5"`,
        });
        _mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });
    _mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      expect(segList[0].key).toEqual({
        method: "AES-128",
        uri: "https://mock.mock.com/live/mock-key.bin",
        iv: "5432554205",
        format: "mock",
        formatVersions: "1/2/5",
      });
      expect(segList[lastIdx - 1].index).toBe(15);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(0);
    });
  });
  it("should record VOD type HLS stream, and handle #EXT-X-KEY tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    nock.cleanAll();
    const targetEndlistIndex = 16;
    const _mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    _mockHLSSource.setMultiVariant(config);
    _mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: targetEndlistIndex + 1,
    });
    _mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, _mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-500500", {
          keyString: `#EXT-X-KEY:METHOD=AES-128,URI="mock-key.bin",IV=5432554205,KEYFORMAT="mock",KEYFORMATVERSIONS="1/2/5"`,
        });
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-700700", {
          keyString: `#EXT-X-KEY:METHOD=AES-128,URI="mock-key.bin",IV=5432554205,KEYFORMAT="mock",KEYFORMATVERSIONS="1/2/5"`,
        });
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      expect(segList[0].key).toEqual({
        method: "AES-128",
        uri: "https://mock.mock.com/live/mock-key.bin",
        iv: "5432554205",
        format: "mock",
        formatVersions: "1/2/5",
      });
      expect(segList[lastIdx - 1].index).toBe(16);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(0);
    });
  });
});

//HLSRecorder: Fragmented MP4
describe("HLSRecorder, when source uses fMP4,", () => {
  let mockHLSSource: MockLiveM3U8Generator;
  beforeEach(() => {
    jasmine.clock().install();
    mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500", {
          mapString: `#EXT-X-MAP:URI="mock-init.mp4"`,
        });
        mockHLSSource.shiftSegments("video-500500", 1);
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700", {
          mapString: `#EXT-X-MAP:URI="mock-init.mp4"`,
        });
        mockHLSSource.shiftSegments("video-700700", 1);
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });
  //Test 4
  it("should record Live type HLS stream, and handle #EXT-X-MAP tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 20;
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.m4s`);
      expect(segList[0].map).toEqual({
        uri: "https://mock.mock.com/live/mock-init.mp4",
        byterange: null,
      });
      expect(segList[lastIdx - 1].index).toBe(20);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.m4s`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(14);
    });
  });
  it("should record Event type HLS stream, and handle #EXT-X-MAP tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    nock.cleanAll();
    const targetEndlistIndex = 20;
    const _mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    _mockHLSSource.setMultiVariant(config);
    _mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, _mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-500500", {
          mapString: `#EXT-X-MAP:URI="mock-init.mp4"`,
        });
        _mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-700700", {
          mapString: `#EXT-X-MAP:URI="mock-init.mp4"`,
        });
        _mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });
    _mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.m4s`);
      expect(segList[0].map).toEqual({
        uri: "https://mock.mock.com/live/mock-init.mp4",
        byterange: null,
      });
      expect(segList[lastIdx - 1].index).toBe(20);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.m4s`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(0);
    });
  });
  it("should record VOD type HLS stream, and handle #EXT-X-MAP tag.", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    nock.cleanAll();
    const targetEndlistIndex = 20;
    const _mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    _mockHLSSource.setMultiVariant(config);
    _mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: targetEndlistIndex + 1,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, _mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-500500", {
          mapString: `#EXT-X-MAP:URI="mock-init.mp4"`,
        });
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = _mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-700700", {
          mapString: `#EXT-X-MAP:URI="mock-init.mp4"`,
        });
        return m3u8;
      });
    _mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;

      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.m4s`);
      expect(segList[0].map).toEqual({
        uri: "https://mock.mock.com/live/mock-init.mp4",
        byterange: null,
      });
      expect(segList[lastIdx - 1].index).toBe(20);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.m4s`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(0);
    });
  });
});

// HLSRecorder: Multi-tracks
describe("HLSRecorder, when source has multiple tracks,", () => {
  beforeEach(() => {
    jasmine.clock().install();
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });
  //Test 5
  it("should record Live type HLS stream with demuxed audio, and stop when recordDuration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: aTracks,
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
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
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_11.ts`);
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
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/audio-${group}_${lang}-seg_11.ts`
        );
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });
  it("should record Live type HLS stream with subtitles, and stop when recordDuration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: sTracks,
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
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
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_11.ts`);
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
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/sub-${group}_${lang}-seg_11.ts`
        );
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });
  it("should record Live type HLS stream with demuxed audio and subtitles, and stop when recordDuration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: aTracks,
      subtitleTracks: sTracks,
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
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
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_11.ts`);
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
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/audio-${group}_${lang}-seg_11.ts`
        );
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
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/sub-${group}_${lang}-seg_11.ts`
        );
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });
  it("should record Event type HLS stream with demuxed audio and subtitles, and stop when recordDuration is reached", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: aTracks,
      subtitleTracks: sTracks,
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-500500");
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "video-700700");
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      })
      .get("/live/audio-aac_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "audio-aac_en");
        mockHLSSource.pushSegments("audio-aac_en", 1);
        return m3u8;
      })
      .get("/live/audio-aac_sv.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "audio-aac_sv");
        mockHLSSource.pushSegments("audio-aac_sv", 1);
        return m3u8;
      })
      .get("/live/sub-cc_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.EVENT, "sub-cc_en");
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
      expect(segList[lastIdx - 1].index).toBe(12);
      expect(segList[lastIdx - 1].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_11.ts`);
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
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/audio-${group}_${lang}-seg_11.ts`
        );
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
        expect(segList[lastIdx - 1].index).toBe(12);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/sub-${group}_${lang}-seg_11.ts`
        );
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });
  it("should record VOD type HLS stream with demuxed audio and subtitles", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const mockHLSSource = new MockLiveM3U8Generator();
    const targetEndIndex = 36;
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: aTracks,
      subtitleTracks: sTracks,
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: targetEndIndex + 1,
    });
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndIndex,
      stopAfter: true,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-500500");
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "video-700700");
        return m3u8;
      })
      .get("/live/audio-aac_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "audio-aac_en");
        return m3u8;
      })
      .get("/live/audio-aac_sv.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "audio-aac_sv");
        return m3u8;
      })
      .get("/live/sub-cc_en.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.VOD, "sub-cc_en");
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
      expect(segList[lastIdx - 1].index).toBe(targetEndIndex);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndIndex - 1}.ts`
      );
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
        expect(segList[lastIdx - 1].index).toBe(targetEndIndex);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/audio-${group}_${lang}-seg_${targetEndIndex - 1}.ts`
        );
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
        expect(segList[lastIdx - 1].index).toBe(targetEndIndex);
        expect(segList[lastIdx - 1].uri).toBe(
          `https://mock.mock.com/live/sub-${group}_${lang}-seg_${targetEndIndex - 1}.ts`
        );
        expect(segList[lastIdx].index).toBe(null);
        expect(segList[lastIdx].endlist).toBe(true);
      });
    });
  });
});

// HLSRecorder: Cookies
describe("HLSRecorder, when source requires cookie", () => {
  beforeEach(() => {
    jasmine.clock().install();
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });
  it("should record Live type HLS stream, obtain cookies if any and pass cookieJar in 'mseq-increment' event", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 20;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
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
    // Mock Source Becomming a VOD,
    // will slap on an endlist tag at this seg index
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant(), {
        "Content-Type": "application/x-mpegURL;charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "strict-transport-security": "max-age=31536000; includeSubDomains",
        "cache-control": "public, max-age=60",
        "access-control-allow-credentials": "true",
        "set-cookie": "jwt=eyJhbGcihw; HttpOnly; SameSite=None; Path=/live",
        "access-control-max-age": "600",
      })
      .get("/live/level_0.m3u8")
      .reply(function (uri: string, requestBody: any) {
        if (!this.req.headers["cookie"].includes("jwt=eyJhbGcihw")) {
          return [201, "Invalid Cookie"];
        } else {
          const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
          mockHLSSource.pushSegments("video-500500", 1);
          return [200, m3u8];
        }
      })
      .get("/live/level_1.m3u8")
      .reply(function (uri: string, requestBody: any) {
        if (!this.req.headers["cookie"].includes("jwt=eyJhbGcihw")) {
          return [201, "Invalid Cookie"];
        } else {
          const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
          mockHLSSource.pushSegments("video-700700", 1);
          return [200, m3u8];
        }
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      // Check First Segment
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      // Check Second-to-Last Segment
      expect(segList[lastIdx - 1].index).toBe(20);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      // Check Last Segment
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(0); // Event stream is on the same mseq...
    });
  });
});

// HLSRecorder: PLAYLIST-TYPE=EVENT
describe("HLSRecorder, when source is EVENT,", () => {
  let mockHLSSource: MockLiveM3U8Generator;
  beforeEach(() => {
    jasmine.clock().install();
    mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
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
        mockHLSSource.pushSegments("video-500500", 1);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.pushSegments("video-700700", 1);
        return m3u8;
      });
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });
  it("should record Event type HLS stream, and end recording when #EXT-X-ENDLIST appears in HLS stream", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 15;
    // Mock Source Becomming a VOD,
    // will slap on an endlist tag at this seg index
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      // Check First Segment
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      // Check Second-to-Last Segment
      expect(segList[lastIdx - 1].index).toBe(15);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      // Check Last Segment
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(0); // Event stream is on the same mseq...
    });
  });
});

describe("HLSRecorder, when source is not perfect,", () => {
  beforeEach(() => {
    jasmine.clock().install();
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });

  it("should record Live type HLS stream, and handle if source mseq increases more than 1 step", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 21;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
    });
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        mockHLSSource.shiftSegments("video-500500", 3);
        mockHLSSource.pushSegments("video-500500", 3);
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        mockHLSSource.shiftSegments("video-700700", 3);
        mockHLSSource.pushSegments("video-700700", 3);
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      expect(segList[lastIdx - 1].index).toBe(21);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(15);
    });
  });
  it("should record Live type HLS stream, and handle if source mseq accross variants are not synced", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    let countA = 0;
    let countB = 0;
    const targetEndlistIndex = 21;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
    });
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/master.m3u8")
      .reply(200, mockHLSSource.getMultiVariant())
      .get("/live/level_0.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        countA++;
        if (countA !== 3) {
          mockHLSSource.shiftSegments("video-500500", 1);
          mockHLSSource.pushSegments("video-500500", 1);
        }
        return m3u8;
      })
      .get("/live/level_1.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-700700");
        countB++;
        if (countB !== 4) {
          mockHLSSource.shiftSegments("video-700700", 1);
          mockHLSSource.pushSegments("video-700700", 1);
        }
        return m3u8;
      });

    const recorder = new HLSRecorder(mockLiveUri, {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-${bw}-seg_0.ts`);
      expect(segList[lastIdx - 1].index).toBe(targetEndlistIndex);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-${bw}-seg_${targetEndlistIndex - 1}.ts`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(15);
    });
  });
  it("should record Live type HLS stream, and handle if source is not a multi-variant manifest", async () => {
    let LAST_RETURNED_EVENT_DATA: any;
    const targetEndlistIndex = 21;
    let countA = 0;
    const mockHLSSource = new MockLiveM3U8Generator();
    const config: ISetMultiVariantInput = {
      videoTracks: vTracks,
      audioTracks: [],
      subtitleTracks: [],
    };
    mockHLSSource.setMultiVariant(config);
    mockHLSSource.setInitPlaylistData({
      MSEQ: 0,
      DSEQ: 0,
      TARGET_DUR: 10,
      START_ON: 0,
      END_ON: 6,
    });
    mockHLSSource.insertAt({
      replacementString: "#EXT-X-ENDLIST",
      targetSegmentIndex: targetEndlistIndex,
      stopAfter: true,
    });
    nock(mockBaseUri)
      .persist()
      .get("/live/video-500500.m3u8")
      .reply(200, () => {
        const m3u8 = mockHLSSource.getMediaPlaylistM3U8(EnumStreamType.LIVE, "video-500500");
        countA++;
        if (countA !== 1) {
          mockHLSSource.shiftSegments("video-500500", 1);
          mockHLSSource.pushSegments("video-500500", 1);
        }
        return m3u8;
      });

    const recorder = new HLSRecorder("https://mock.mock.com/live/video-500500.m3u8", {
      recordDuration: -1,
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
    const bandwidths = Object.keys(videoVariants);
    bandwidths.forEach((bw) => {
      const segList = videoVariants[bw].segList;
      const lastIdx = segList.length - 1;
      expect(segList[0].index).toBe(1);
      expect(segList[0].uri).toBe(`https://mock.mock.com/live/video-500500-seg_0.ts`);
      expect(segList[lastIdx - 1].index).toBe(21);
      expect(segList[lastIdx - 1].uri).toBe(
        `https://mock.mock.com/live/video-500500-seg_${targetEndlistIndex - 1}.ts`
      );
      expect(segList[targetEndlistIndex].index).toBe(null);
      expect(segList[targetEndlistIndex].endlist).toBe(true);
      expect(LAST_RETURNED_EVENT_DATA.allPlaylistSegments["video"][bw].mediaSeq).toBe(15);
    });
  });
});

// TODO: Test Channel Engine Support
describe("HLSRecorder, when ", () => {
  beforeEach(() => {
    jasmine.clock().install();
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });

  it("should record Live type HLS stream, ----- ", async () => {});
});
// TODO: Test error/failing cases
describe("HLSRecorder, when ", () => {
  beforeEach(() => {
    jasmine.clock().install();
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    nock.cleanAll();
  });

  it("should record Live type HLS stream, ----- ", async () => {});
});
