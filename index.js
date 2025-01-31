const express = require("express");
const fs = require("fs");
const path = require("path");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { exec } = require("child_process");

fluentFfmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");

// Ensure the output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// Function to clear old files in the output directory
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
            if (err) console.error("Error deleting file:", err);
            else console.log(`Deleted old file: ${filePath}`);
          });
        }
      });
    });
  });
};

// Schedule cleanup every 5 minutes
setInterval(clearOldFiles, 5 * 60 * 1000);

// API endpoint to fetch video download link
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided." });
  }

  try {
    // Generate file names
    const sanitizedTitle = `video_${Date.now()}`; // Unique file name
    const videoPath = path.join(OUTPUT_DIR, `${sanitizedTitle}_video.mp4`);
    const audioPath = path.join(OUTPUT_DIR, `${sanitizedTitle}_audio.mp4`);
    const outputPath = path.join(OUTPUT_DIR, `${sanitizedTitle}.mp4`);

    // Download video and audio separately using yt-dlp
    const ytDlpBaseCommand = `yt-dlp --cookies "${COOKIES_PATH}" -f`;

    const videoCommand = `${ytDlpBaseCommand} "bestvideo" -o "${videoPath}" "${videoUrl}"`;
    const audioCommand = `${ytDlpBaseCommand} "bestaudio" -o "${audioPath}" "${videoUrl}"`;

    await Promise.all([
      new Promise((resolve, reject) => {
        exec(videoCommand, (error, stdout, stderr) => {
          if (error) return reject(`Video download error: ${stderr}`);
          console.log(stdout);
          resolve();
        });
      }),
      new Promise((resolve, reject) => {
        exec(audioCommand, (error, stdout, stderr) => {
          if (error) return reject(`Audio download error: ${stderr}`);
          console.log(stdout);
          resolve();
        });
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
        fs.unlinkSync(videoPath);
        fs.unlinkSync(audioPath);

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
    res.status(500).json({ error: "Something went wrong: " + error });
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
