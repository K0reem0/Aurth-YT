const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

fluentFfmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

/* ================== الإعدادات ================== */
const OUTPUT_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

/* ================== تنظيف الملفات ================== */
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

/* ================== تشغيل yt-dlp ================== */
const runYtDlp = (args) =>
  new Promise((resolve, reject) => {
    execFile(YTDLP_PATH, args, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });

/* ================== API ================== */
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;
  // استلام الدقة المطلوبة من المستخدم أو تعيين 720 كافتراضي
  const requestedRes = req.query.res || "720"; 

  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided" });
  }

  try {
    const title = `video_${Date.now()}`;
    const outputPath = path.join(OUTPUT_DIR, `${title}.mp4`);

    const isTikTok = videoUrl.includes("tiktok.com");
    const isInstagram = videoUrl.includes("instagram.com");
    const isFacebook = videoUrl.includes("facebook.com") || videoUrl.includes("fb.watch");
    const isTwitter = videoUrl.includes("twitter.com") || videoUrl.includes("x.com");

    let formatSelection = "";

    if (isTikTok || isInstagram) {
      /* المنطق:
         1. ابحث عن فيديو بالدقة المطلوبة (مثلاً 720) وحجمه أقل من 25MB.
         2. إذا لم يجد، ابحث عن أي فيديو جودته 480p أو أقل.
         3. إذا لم يجد، حمل أفضل نسخة متاحة.
      */
      formatSelection = `best[height<=${requestedRes}][filesize<8]/best[height<=480]/best`;
    } else if (isFacebook || isTwitter) {
      formatSelection = `best[height<=${requestedRes}]/best`;
    }

    /* ===== معالجة المنصات (TikTok, Insta, FB, Twitter) ===== */
    if (isTikTok || isInstagram || isFacebook || isTwitter) {
      await runYtDlp([
        videoUrl,
        "-f", formatSelection,
        "-o", outputPath,
        "--merge-output-format", "mp4",
        "--cookies", COOKIES_PATH,
        "--no-playlist",
      ]);
    } else {
      /* ===== YouTube: فيديو + صوت ===== */
      const videoPath = path.join(OUTPUT_DIR, `${title}_video.mp4`);
      const audioPath = path.join(OUTPUT_DIR, `${title}_audio.m4a`);

      await Promise.all([
        runYtDlp([
          videoUrl,
          "-f", `bestvideo[height<=${requestedRes}]+bestaudio/best[height<=${requestedRes}]`,
          "-o", videoPath,
          "--cookies", COOKIES_PATH,
          "--no-playlist",
        ]),
        runYtDlp([
          videoUrl,
          "-f", "bestaudio",
          "-o", audioPath,
          "--cookies", COOKIES_PATH,
          "--no-playlist",
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

      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    const downloadUrl = `${req.protocol}://${req.get("host")}/downloads/${path.basename(outputPath)}`;

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
            requested_resolution: requestedRes,
          },
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ... باقي الكود (test-ytdlp, static files, server listen) ... */
app.get("/", (req, res) => res.send("آرثر هنا — الأنظمة تعمل ✅"));
app.use("/downloads", express.static(OUTPUT_DIR));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
