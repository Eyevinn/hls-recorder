import { HLSRecorder } from ".";
const ChannelEngine = require("eyevinn-channel-engine");
const m3u8 = require("@eyevinn/m3u8");
const urlFetch = require("node-fetch");
const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));
const VOD_URI: string =
  "https://playertest.longtailvideo.com/adaptive/elephants_dream_v4/index.m3u8"; //"https://nfrederiksen.github.io/testing-streams-hls/test-audio-birdsNgoats/playlist.m3u8";

class SDSAssetManager {
  assets: { [key: string]: any[] };
  mockAssets?: { [key: string]: any[] };
  pos: { [key: string]: number };

  constructor(opts: { vodUri: string; mockAsset?: string }) {
    // For Specs
    if (opts.mockAsset) {
      let mockJson: any = JSON.parse(opts.mockAsset);
      this.mockAssets = {
        "mock-1": [
          {
            id: mockJson.id,
            title: mockJson.title,
            uri: mockJson.uri,
            timedMetadata: { "start-date": "2021-09-30T12:16:20.889Z" },
          },
        ],
      };
    }

    this.assets = {
      "1": [
        {
          id: "1",
          title: "Input VOD",
          uri: opts.vodUri,
        },
      ],
    };
    this.pos = {
      "1": 0,
    };
  }

  getNextVod(vodRequest: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // For Specs
      if (this.mockAssets) {
        resolve(this.mockAssets["mock-1"][0]);
      }

      const channelId = vodRequest.playlistId;
      if (this.assets[channelId]) {
        let vod = this.assets[channelId][this.pos[channelId]++];
        if (this.pos[channelId] > this.assets[channelId].length - 1) {
          this.pos[channelId] = 0;
        }
        vod.timedMetadata = {
          "start-date": new Date().toISOString(),
        };
        resolve(vod);
      } else {
        reject("Invalid channelId provided");
      }
    });
  }

  handleError(err: any, vodResponse: any) {
    console.error(err.message, JSON.stringify(vodResponse, null, 2));
  }
}

export default class SDSChannelManager {
  channels: any[];

  constructor(opts?: any) {
    let channel: any = {
      id: "1",
      profile: opts?.videoProfiles || this._getProfile,
      audioTracks: opts?.audioProfiles || this._getAudioTracks,
    };
    this.channels = [channel];
  }

  getChannels(): any[] {
    return this.channels;
  }

  _getProfile(): any[] {
    return [
      { bw: 6134000, codecs: "avc1.4d001f,mp4a.40.2", resolution: [1024, 458] },
      { bw: 2323000, codecs: "avc1.4d001f,mp4a.40.2", resolution: [640, 286] },
      { bw: 1313000, codecs: "avc1.4d001f,mp4a.40.2", resolution: [480, 214] },
    ];
  }

  _getAudioTracks(): any[] {
    return [{ language: "en", name: "English", default: true }];
  }
}

const run = async () => {
  const PROFILES: any = await ParseProfilesFromMasterManifest(VOD_URI);
  //console.log("Found Vod Profiles", JSON.stringify(PROFILES, null, 2));

  const channelManager: any = new SDSChannelManager({
    videoProfiles: PROFILES.video,
    audioProfiles: PROFILES.audio,
  });
  const assetManager: any = new SDSAssetManager({ vodUri: VOD_URI });

  const engineOptions = {
    heartbeat: "/",
    channelManager: channelManager,
    //useDemuxedAudio: true,
    //cloudWatchMetrics: true
  };
  console.log(engineOptions);

  const engine = new ChannelEngine(assetManager, engineOptions);
  engine.start();
  engine.listen(8000);
  await timer(3000);
  const recorder = new HLSRecorder(engine, { windowSize: 120, vod: true });

  console.log("[test-server.js]: Starting HLSRecorder...");
  recorder
    .start()
    .then((msg: string) => console.log("[test-server.js]: ...we done:", msg))
    .catch((err) => console.log(err));

  recorder.on("mseq-increment", (mseq: number) => {
    console.log(
      "[test-server.js]: recorder.on('mseq-increment') triggered! The mseq became:" +
        JSON.stringify(mseq)
    );
  });
};

// Run the Servers---
run();
//-------------------

// Helper Function
function ParseProfilesFromMasterManifest(masterURI: string) {
  let VOD_PROFILES: any = {
    video: [],
    audio: [],
  };

  return new Promise((resolve, reject) => {
    //console.log("Starting HLS parsing job on:", masterURI);

    const parser = m3u8.createStream();

    parser.on(
      "m3u",
      (m3u: { items: { StreamItem: any[]; MediaItem: any[] } }) => {
        let targetAudioGroupID: string = "";

        // Get all Video profiles from Master Manifest
        for (let i = 0; i < m3u.items.StreamItem.length; i++) {
          let newProfile: any = {
            bw: 0,
            codecs: "",
            resolution: [],
          };

          const streamItem = m3u.items.StreamItem[i];

          if (streamItem.get("bandwidth")) {
            newProfile.bw = streamItem.get("bandwidth");
            if (streamItem.get("resolution")) {
              newProfile.resolution = [
                streamItem.get("resolution")[0],
                streamItem.get("resolution")[1],
              ];
            }
            if (streamItem.get("codecs")) {
              newProfile.codecs = streamItem.get("codecs");
            }

            VOD_PROFILES.video.push(newProfile);

            // Find what audio GROUP-ID stream variants are equiped with.
            if (streamItem.attributes.attributes["audio"]) {
              targetAudioGroupID = streamItem.attributes.attributes["audio"];
            }
          }
        }

        // Get all Audio profiles from Master Manifest
        let audioGroupItems = m3u.items.MediaItem.filter((item) => {
          return (
            item.attributes.attributes.type === "AUDIO" &&
            item.attributes.attributes["group-id"] === targetAudioGroupID
          );
        });
        // Extract every audio mediaitem's relevant attributes
        audioGroupItems.map((audioItem) => {
          let newAudioProfile: any = {
            language: "",
            name: "",
          };
          if (audioItem.attributes.attributes["language"]) {
            newAudioProfile.language =
              audioItem.attributes.attributes["language"];
          }
          if (audioItem.attributes.attributes["name"]) {
            newAudioProfile.name = audioItem.attributes.attributes["name"];
          }
          VOD_PROFILES["audio"].push(newAudioProfile);
        });
        resolve(VOD_PROFILES);
      }
    );

    parser.on("error", (exc: any) => {
      console.error(`Parser Error: ${JSON.stringify(exc)}`);
      reject(exc);
    });
    urlFetch(masterURI)
      .then((res: { body: { pipe: (arg0: any) => void } }) => {
        res.body.pipe(parser);
      })
      .catch(reject);
  });
}
