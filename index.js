const express = require("express");
const axios = require("axios"); // Importing axios
const ytdl = require("@distube/ytdl-core");
const fs = require("fs");
const path = require("path");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

fluentFfmpeg.setFfmpegPath(ffmpegPath); // Set ffmpeg path to the static binary

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(__dirname, "downloads");

// Ensure the output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// Example: Making an Axios request
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

axios
  .get("https://example.com", { headers })
  .then((response) => console.log("Axios Response Data:", response.data))
  .catch((error) => console.error("Axios Error:", error.message));

// API endpoint to fetch video download link
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided." });
  }

  try {
    // Validate the video URL
    const isValid = ytdl.validateURL(videoUrl);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid video URL. Please check the URL and try again." });
    }

    // Fetch video info
    const videoInfo = await ytdl.getInfo(videoUrl);
    const videoId = videoInfo.videoDetails.videoId;
    const title = videoInfo.videoDetails.title.replace(/[\/\\?%*:|"<>]/g, ""); // Sanitize title for filesystem
    const videoPath = path.join(OUTPUT_DIR, `${title}_video.mp4`);
    const audioPath = path.join(OUTPUT_DIR, `${title}_audio.mp4`);
    const outputPath = path.join(OUTPUT_DIR, `${title}.mp4`);

    // Download video and audio
    const videoStream = ytdl(videoUrl, { quality: "highestvideo" });
    const audioStream = ytdl(videoUrl, { quality: "highestaudio" });

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

    // Merge video and audio using fluent-ffmpeg
    fluentFfmpeg()
      .input(videoPath)
      .input(audioPath)
      .audioCodec("aac")
      .videoCodec("copy")
      .output(outputPath)
      .on("end", () => {
        // Clean up intermediate files
        fs.unlinkSync(videoPath);
        fs.unlinkSync(audioPath);

        // Provide the download link
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
    console.error("Error processing video:", error.message);
    res.status(500).json({ error: "Something went wrong: " + error.message });
  }
});

// Serve the merged files
app.use("/downloads", express.static(OUTPUT_DIR));

// Root endpoint for health check
app.get("/", (req, res) => {
  res.send("آرثر هنا كل شيء يعمل بخير!");
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
