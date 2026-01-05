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
// تأكد من تثبيت yt-dlp في النظام أو تحديد مساره هنا
const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

/* ================== تنظيف الملفات تلقائياً (كل 5 دقائق) ================== */
const clearOldFiles = async () => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 دقائق
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

/* ================== دالة تشغيل yt-dlp ================== */
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

/* ================== API التحميل ================== */
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;
  // الجودة الافتراضية 480
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

    // "res:480" تعني: ابحث عن 480p، وإذا لم تجدها خذ الأقل منها مباشرة ولا تتجاوزها.
    const formatSortOrder = `res:${requestedRes}`;

    /* ===== معالجة السوشيال ميديا (Insta, TikTok, FB, Twitter) ===== */
    if (isTikTok || isInstagram || isFacebook || isTwitter) {
      await runYtDlp([
        videoUrl,
        "-f", `best[height<=${requestedRes}][ext=mp4]/best[height<=${requestedRes}]/best`,
        "--format-sort", formatSortOrder,
        "-o", outputPath,
        "--merge-output-format", "mp4",
        "--cookies", COOKIES_PATH,
        "--no-playlist",
      ]);
    } 
    /* ===== معالجة اليوتيوب (فيديو + صوت منفصلين لضمان الجودة) ===== */
    else {
      const videoPath = path.join(OUTPUT_DIR, `${title}_video.mp4`);
      const audioPath = path.join(OUTPUT_DIR, `${title}_audio.m4a`);

      await Promise.all([
        runYtDlp([
          videoUrl,
          "-f", `bestvideo[height<=${requestedRes}][ext=mp4]/bestvideo[height<=${requestedRes}]`,
          "--format-sort", formatSortOrder,
          "-o", videoPath,
          "--cookies", COOKIES_PATH,
          "--no-playlist",
        ]),
        runYtDlp([
          videoUrl,
          "-f", "bestaudio[ext=m4a]/bestaudio",
          "-o", audioPath,
          "--cookies", COOKIES_PATH,
          "--no-playlist",
        ]),
      ]);

      // دمج الفيديو والصوت باستخدام FFmpeg
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

      // حذف الملفات المؤقتة بعد الدمج
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    const downloadUrl = `${req.protocol}://${req.get("host")}/downloads/${path.basename(outputPath)}`;

    res.json({
      status: true,
      creator: "AURTHER~آرثر",
      data: {
        title: title,
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
    console.error("Error details:", err.message);
    res.status(500).json({ error: "فشل في معالجة الفيديو. تأكد من الرابط أو ملف الكوكيز." });
  }
});

/* ================== تشغيل السيرفر ================== */
app.get("/", (req, res) => res.send("آرثر هنا — الأنظمة تعمل والجودة مقيدة بـ 480p ✅"));
app.use("/downloads", express.static(OUTPUT_DIR));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
