const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// إعداد مسار FFmpeg
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

/* ================== وظيفة الضغط الذكي ================== */
/**
 * تقوم هذه الوظيفة بحساب البت ريت المناسب لجعل الفيديو أقل من 8 ميجابايت
 */
const compressToTargetSize = (inputPath, targetSizeMB = 7.8) => {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(OUTPUT_DIR, `compressed_${Date.now()}.mp4`);

    fluentFfmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);

      const duration = metadata.format.duration; // مدة الفيديو بالثواني
      // الحجم المستهدف بالبت (Target Size in bits)
      const targetSizeBits = targetSizeMB * 1024 * 1024 * 8;
      // حساب البت ريت الكلي (فيديو + صوت)
      let totalBitrate = Math.floor(targetSizeBits / duration);
      
      // تخصيص 128 كيلوبت للصوت والباقي للفيديو
      let audioBitrate = 128000; 
      let videoBitrate = totalBitrate - audioBitrate;

      // التأكد من أن البت ريت ليس سالباً أو ضعيفاً جداً
      if (videoBitrate < 100000) {
        videoBitrate = 150000; // حد أدنى للجودة
      }

      fluentFfmpeg(inputPath)
        .outputOptions([
          `-b:v ${videoBitrate}`,
          `-maxrate ${videoBitrate}`,
          `-bufsize ${videoBitrate * 2}`,
          "-preset fast", // موازنة بين السرعة والجودة
        ])
        .audioBitrate(128)
        .save(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(err));
    });
  });
};

/* ================== تنظيف الملفات القديمة ================== */
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

/* ================== API الرئيسي ================== */
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;
  const requestedRes = req.query.res || "720"; 

  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided" });
  }

  try {
    const title = `video_${Date.now()}`;
    let finalPath = path.join(OUTPUT_DIR, `${title}.mp4`);

    const isTikTok = videoUrl.includes("tiktok.com");
    const isInstagram = videoUrl.includes("instagram.com");
    const isFacebook = videoUrl.includes("facebook.com") || videoUrl.includes("fb.watch");
    const isTwitter = videoUrl.includes("twitter.com") || videoUrl.includes("x.com");

    let formatSelection = `best[height<=${requestedRes}]/best`;

    if (isTikTok || isInstagram || isFacebook || isTwitter) {
      // تحميل مباشر للمنصات الاجتماعية
      await runYtDlp([
        videoUrl,
        "-f", formatSelection,
        "-o", finalPath,
        "--merge-output-format", "mp4",
        "--cookies", COOKIES_PATH,
        "--no-playlist",
      ]);
    } else {
      /* YouTube logic */
      const videoPath = path.join(OUTPUT_DIR, `${title}_video.mp4`);
      const audioPath = path.join(OUTPUT_DIR, `${title}_audio.m4a`);

      await Promise.all([
        runYtDlp([videoUrl, "-f", `bestvideo[height<=${requestedRes}]`, "-o", videoPath, "--cookies", COOKIES_PATH]),
        runYtDlp([videoUrl, "-f", "bestaudio", "-o", audioPath, "--cookies", COOKIES_PATH])
      ]);

      await new Promise((resolve, reject) => {
        fluentFfmpeg().input(videoPath).input(audioPath).videoCodec("copy").audioCodec("aac").output(finalPath).on("end", resolve).on("error", reject).run();
      });

      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    /* === منطق فحص الحجم والضغط === */
    let stats = fs.statSync(finalPath);
    let fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > 8) {
      console.log(`File is ${fileSizeMB.toFixed(2)}MB. Compressing...`);
      try {
        const compressedFilePath = await compressToTargetSize(finalPath);
        // حذف الملف الأصلي الكبير
        fs.unlinkSync(finalPath);
        // استبدال المسار بالملف المضغوط
        finalPath = compressedFilePath;
        stats = fs.statSync(finalPath);
        fileSizeMB = stats.size / (1024 * 1024);
      } catch (compressErr) {
        console.error("Compression failed, sending original:", compressErr);
      }
    }

    const downloadUrl = `${req.protocol}://${req.get("host")}/downloads/${path.basename(finalPath)}`;

    res.json({
      status: true,
      creator: "AURTHER~آرثر",
      data: {
        title,
        size_mb: fileSizeMB.toFixed(2),
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

app.get("/", (req, res) => res.send("آرثر هنا — الأنظمة تعمل ✅"));
app.use("/downloads", express.static(OUTPUT_DIR));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
