const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

fluentFfmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

/* المسارات */
const OUTPUT_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";

/* إنشاء مجلد التحميل */
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

/* حذف الملفات القديمة (5 دقائق) */
const clearOldFiles = async () => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000;

  try {
    const files = await fs.promises.readdir(OUTPUT_DIR);
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(OUTPUT_DIR, file);
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAge) {
          await fs.promises.unlink(filePath);
        }
      })
    );
  } catch (err) {
    console.error("Cleanup error:", err);
  }
};

setInterval(clearOldFiles, 5 * 60 * 1000);

/* تشغيل yt-dlp */
const runYtDlp = (args) =>
  new Promise((resolve, reject) => {
    execFile(YTDLP_PATH, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });

/* API */
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided" });
  }

  try {
    const title = `video_${Date.now()}`;
    const outputPath = path.join(OUTPUT_DIR, `${title}.mp4`);

    const isTikTok = videoUrl.includes("tiktok.com");
    const isFacebook =
      videoUrl.includes("facebook.com") || videoUrl.includes("fb.watch");
    const isInstagram = videoUrl.includes("instagram.com");
    const isTwitter =
      videoUrl.includes("twitter.com") || videoUrl.includes("x.com");

    /* منصات بملف واحد */
    if (isTikTok || isFacebook || isInstagram || isTwitter) {
      await runYtDlp([
        videoUrl,
        "-f",
        "best",
        "-o",
        outputPath,
        "--cookies",
        COOKIES_PATH,
      ]);
    } else {
      /* يوتيوب: فيديو + صوت */
      const videoPath = path.join(OUTPUT_DIR, `${title}_video.mp4`);
      const audioPath = path.join(OUTPUT_DIR, `${title}_audio.m4a`);

      await Promise.all([
        runYtDlp([
          videoUrl,
          "-f",
          "bestvideo[height<=720]",
          "-o",
          videoPath,
          "--cookies",
          COOKIES_PATH,
        ]),
        runYtDlp([
          videoUrl,
          "-f",
          "bestaudio",
          "-o",
          audioPath,
          "--cookies",
          COOKIES_PATH,
        ]),
      ]);

      await new Promise((resolve, reject) => {
        fluentFfmpeg()
          .input(videoPath)
          .input(audioPath)
          .videoCodec("copy")
          .audioCodec("aac")
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      fs.unlinkSync(videoPath);
      fs.unlinkSync(audioPath);
    }

    const downloadUrl = `${req.protocol}://${req.get(
      "host"
    )}/downloads/${path.basename(outputPath)}`;

    res.json({
      status: true,
      creator: "AURTHER~آرثر",
      data: {
        title,
        media: {
          type: "video",
          download: {
            url: downloadUrl,
            format: "mp4",
            quality:
              isTikTok || isFacebook || isInstagram || isTwitter
                ? "best"
                : "720p",
          },
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* اختبار yt-dlp */
app.get("/test-ytdlp", async (req, res) => {
  try {
    const version = await runYtDlp(["--version"]);
    res.send(`yt-dlp يعمل ✅ (${version.trim()})`);
  } catch {
    res.status(500).send("yt-dlp لا يعمل ❌");
  }
});

/* تقديم الملفات */
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

/* فحص الصحة */
app.get("/", (req, res) => {
  res.send("آرثر هنا — كل شيء يعمل تمامًا ✅");
});

/* تشغيل السيرفر */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
