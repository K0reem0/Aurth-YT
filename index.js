const express = require("express");
const fs = require("fs");
const path = require("path");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ytDlp = require("yt-dlp-exec");

fluentFfmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

const clearOldFiles = async () => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  try {
    const files = await fs.promises.readdir(OUTPUT_DIR);
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(OUTPUT_DIR, file);
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > fiveMinutes) {
          await fs.promises.unlink(filePath);
          console.log(`Deleted old file: ${filePath}`);
        }
      })
    );
  } catch (err) {
    console.error("Error clearing old files:", err);
  }
};

setInterval(clearOldFiles, 5 * 60 * 1000);

// API endpoint to fetch video download link
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided." });
  }

  try {
    const sanitizedTitle = `video_${Date.now()}`;
    const outputPath = path.join(OUTPUT_DIR, `${sanitizedTitle}.mp4`);

    // Check if the URL is from TikTok, Facebook, Instagram, Twitter, or other platforms
    const isTikTok = videoUrl.includes("tiktok.com");
    const isFacebook =
      videoUrl.includes("facebook.com") || videoUrl.includes("fb.watch");
    const isInstagram = videoUrl.includes("instagram.com");
    const isTwitter =
      videoUrl.includes("twitter.com") || videoUrl.includes("x.com");

    // Download video using yt-dlp
    if (isTikTok || isFacebook || isInstagram || isTwitter) {
      // For TikTok, Facebook, Instagram, and Twitter, download the best available format (usually video + audio combined)
      await ytDlp.exec(videoUrl, { output: outputPath, cookies: COOKIES_PATH });
    } else {
      // For other platforms (e.g., YouTube), download video and audio separately
      const videoPath = path.join(OUTPUT_DIR, `${sanitizedTitle}_video.mp4`);
      const audioPath = path.join(OUTPUT_DIR, `${sanitizedTitle}_audio.mp4`);

      await Promise.all([
        ytDlp.exec(videoUrl, {
          format: "bestvideo[height<=720]",
          output: videoPath,
          cookies: COOKIES_PATH,
        }),
        ytDlp.exec(videoUrl, {
          format: "bestaudio",
          output: audioPath,
          cookies: COOKIES_PATH,
        }),
      ]);

      // Merge video and audio using fluent-ffmpeg
      await new Promise((resolve, reject) => {
        fluentFfmpeg()
          .input(videoPath)
          .input(audioPath)
          .audioCodec("aac")
          .videoCodec("copy")
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      // Cleanup temporary files
      fs.unlinkSync(videoPath);
      fs.unlinkSync(audioPath);
    }

    // Generate download URL
    const downloadUrl = `${req.protocol}://${req.get(
      "host"
    )}/downloads/${path.basename(outputPath)}`;

    res.status(200).json({
      status: true,
      creator: "AURTHER~آرثر",
      process: Math.random().toFixed(4),
      data: {
        title: sanitizedTitle,
        media: {
          type: "video",
          download: {
            url: downloadUrl,
            format: "mp4",
            quality:
              isTikTok || isFacebook || isInstagram || isTwitter
                ? "best"
                : "720p", // TikTok, Facebook, Instagram, and Twitter videos are usually single file
          },
        },
      },
    });
  } catch (error) {
    console.error("Error processing video:", error);
    res.status(500).json({ error: "Something went wrong: " + error.message });
  }
});

// Serve the merged files
app.use(
  "/downloads",
  express.static(OUTPUT_DIR, {
    setHeaders: (res, filePath) => {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${path.basename(filePath)}"`
      );
    },
  })
);

// Root endpoint for health check
app.get("/", (req, res) => {
  res.send("آرثر هنا كل شيء يعمل بخير!");
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
