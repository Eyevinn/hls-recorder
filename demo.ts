import { IRecorderOptions } from "./index.js";
import { HLSRecorder, ISegments } from "./index";

const rec_opts: IRecorderOptions = {
  recordDuration: 114,
  windowSize: -1,
  vod: true,
};

const LIVE_URI = "http://localhost:8000/channels/1/master.m3u8";

const recorder = new HLSRecorder(LIVE_URI, rec_opts);

recorder.on(
  "mseq-increment",
  async (data: { allPlaylistSegments: ISegments }) => {
    const varaints = Object.keys(data.allPlaylistSegments["video"]);
    const level0 = varaints[0];
    console.log(
      `We got something: ${JSON.stringify(
        data.allPlaylistSegments["video"][level0],
        null,
        2
      )}`
    );
  }
);
recorder.on("error", (err: any) => {
  console.log(`ERROR -> ${JSON.stringify(err)}`);
  throw new Error("Something Bad Happend (>.<)");
});

const run = async () => {
  recorder.start();
  recorder.listen(1377);
};
/**********************
 * Run Driver function
 *********************/
run();
