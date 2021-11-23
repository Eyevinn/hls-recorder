import { IRecorderOptions } from "./index.js";
import { HLSRecorder, ISegments } from "./index";

const rec_opts: IRecorderOptions = {
  recordDuration: 120,
  windowSize: -1,
  vod: true,
};

const URI = "http://localhost:8000/channels/1/master.m3u8";
// With PROGRAM-DATE-TIME live live
const URI2 =
  "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8";
// With MAP vod
const URI3 =
  "https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8";
// With KEY vod
const URI4 =
  "https://playertest.longtailvideo.com/adaptive/aes-with-tracks/master.m3u8";

const recorder = new HLSRecorder(URI4, rec_opts);

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
    const groups = Object.keys(data.allPlaylistSegments["audio"]);
    if (groups.length > 0) {
      const languages = Object.keys(
        data.allPlaylistSegments["audio"][groups[0]]
      );
      const lang0 = languages[0];
      console.log(
        `We got some sound: ${JSON.stringify(
          data.allPlaylistSegments["audio"][groups[0]][lang0],
          null,
          2
        )}`
      );
    }
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
