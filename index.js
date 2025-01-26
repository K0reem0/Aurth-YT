const express = require("express");
const ytdl = require("ytdl-core");
const fs = require("fs");
const path = require("path");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const HttpsProxyAgent = require('https-proxy-agent');
const retry = require('async-retry');

fluentFfmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

const clearOldFiles = () => {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    fs.readdir(OUTPUT_DIR, (err, files) => {
        if (err) {
            console.error("Error reading output directory:", err);
            return;
        }

        files.forEach((file) => {
            const filePath = path.join(OUTPUT_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error("Error getting file stats:", err);
                    return;
                }

                if (now - stats.mtimeMs > fiveMinutes) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error("Error deleting file:", err);
                        } else {
                            console.log(`Deleted old file: ${filePath}`);
                        }
                    });
                }
            });
        });
    });
};

setInterval(clearOldFiles, 5 * 60 * 1000);

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/114.0.1823.58 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/109.0',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'
];

const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

const proxies = [
    'http://77.221.154.136:444'
];

const getRandomProxy = () => proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;

const getYtdlInfoWithRetry = async (url) => {
    return retry(async (bail) => {
        try {
            const proxy = getRandomProxy();
            const options = {
                requestOptions: {
                    headers: {
                        'User-Agent': getRandomUserAgent(),
                    },
                },
            };
            if (proxy) {
                options.requestOptions.agent = new HttpsProxyAgent(proxy);
            }
            return await ytdl.getInfo(url, options);
        } catch (error) {
            if (error.message.includes('Sign in to confirm you’re not a bot')) {
                console.error("Bot detection, retrying...");
                throw error;
            } else if (error.message.includes("Status code: 429")) {
                console.error("Rate limited, retrying...");
                throw error;
            } else {
                bail(error);
            }
        }
    }, {
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 8000,
        factor: 2
    });
};

app.get("/api/getVideo", async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ error: "No video URL provided." });
    }

    try {
        const videoInfo = await getYtdlInfoWithRetry(videoUrl);
        const videoId = videoInfo.videoDetails.videoId;
        const title = videoInfo.videoDetails.title.replace(/[\/\\?%*:|"<>]/g, "");
        const videoPath = path.join(OUTPUT_DIR, `${title}_video.mp4`);
        const audioPath = path.join(OUTPUT_DIR, `${title}_audio.mp4`);
        const outputPath = path.join(OUTPUT_DIR, `${title}.mp4`);

        const videoStream = ytdl(videoUrl, { quality: "highestvideo", requestOptions: {headers: {'User-Agent': getRandomUserAgent()}} });
        const audioStream = ytdl(videoUrl, { quality: "highestaudio", requestOptions: {headers: {'User-Agent': getRandomUserAgent()}} });

        const videoWriteStream = fs.createWriteStream(videoPath);
        const audioWriteStream = fs.createWriteStream(audioPath);

        await Promise.all([
            new Promise((resolve, reject) => {
                videoStream.pipe(videoWriteStream);
                videoStream.on("end", resolve);
                videoStream.on("error", reject);
            }),
            new Promise((resolve, reject) => {
                audioStream.pipe(audioWriteStream);
                audioStream.on("end", resolve);
                audioStream.on("error", reject);
            }),
        ]);

        fluentFfmpeg()
            .input(videoPath)
            .input(audioPath)
            .audioCodec("aac")
            .videoCodec("copy")
            .output(outputPath)
            .on("end", () => {
                fs.unlinkSync(videoPath);
                fs.unlinkSync(audioPath);

                const downloadUrl = `${req.protocol}://${req.get("host")}/downloads/${path.basename(outputPath)}`;
                res.status(200).json({
                    status: true,
                    creator: "AURTHER~آرثر",
                    process: Math.random().toFixed(4),
                    data: {
                        id: videoId,
                        title: title,
                        duration: videoInfo.videoDetails.lengthSeconds,
                        author: videoInfo.videoDetails.author.name,
                        media: {
                            type: "video",
                            download: {
                                url: downloadUrl,
                                format: "mp4",
                            },
                        },
                    },
                });
            })
            .on("error", (err) => {
                console.error("Error merging video and audio:", err);
                res.status(500).json({ error: "Failed to merge video and audio." });
            })
            .run();
    } catch (error) {
        console.error("Error processing video:", error);
        res.status(500).json({ error: "Something went wrong: " + error.message });
    }
});

app.use("/downloads", express.static(OUTPUT_DIR));

app.get("/", (req, res) => {
    res.send("آرثر هنا كل شيء يعمل بخير!");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
