// Scenes for exported videos: what's behind and in front of Stu, and where he
// stands in each video shape.
//
// A scene is drawn in layers, back to front:
//   drawBack(ctx, frame)   backdrop (walls, sky, whiteboard...)
//   Stu                    placed at layout(format).stu
//   drawFront(ctx, frame)  optional foreground (a desk edge, grass, props he stands behind)
//   captions               optional, at layout(format).captions
//
// frame = { w, h, t, format, layout }: canvas size, clip time in seconds, the
// format id ("square" | "vertical" | "landscape") and this scene's layout.
//
// anchors: named points (fractions of the frame, per format) for things Stu
// will interact with later - "whiteboard", "bench", "tree". Nothing uses them
// yet; they're here so gestures like "point at the board" have somewhere to
// aim without scenes having to change shape.
//
// To add a scene (classroom, park...): add an entry to SCENES. Image-based
// scenes can list their files in `images` and draw them in drawBack/drawFront;
// load() is awaited once before rendering.

export const FORMATS = {
	square: { label: "Square", detail: "1080 × 1080", w: 1080, h: 1080 },
	vertical: { label: "Vertical", detail: "1080 × 1920 · Reels, TikTok, Shorts", w: 1080, h: 1920 },
	landscape: { label: "Landscape", detail: "1920 × 1080 · YouTube, slides", w: 1920, h: 1080 },
};

// Stu placement: cx = horizontal centre, footY = floor line, height = height
// of Stu's full layer canvas (his figure fills about 95% of it). All fractions
// of the frame height/width. Captions: y = centre of the caption block,
// maxWidth as a fraction of the width, fontSize in px.
const STUDIO_LAYOUT = {
	square: {
		plain: { stu: { cx: 0.5, footY: 0.93, height: 0.84 } },
		captioned: { stu: { cx: 0.5, footY: 0.76, height: 0.66 }, captions: { y: 0.875, maxWidth: 0.86, fontSize: 50 } },
	},
	vertical: {
		plain: { stu: { cx: 0.5, footY: 0.78, height: 0.58 } },
		captioned: { stu: { cx: 0.5, footY: 0.7, height: 0.52 }, captions: { y: 0.82, maxWidth: 0.86, fontSize: 62 } },
	},
	landscape: {
		plain: { stu: { cx: 0.5, footY: 0.93, height: 0.84 } },
		captioned: { stu: { cx: 0.5, footY: 0.78, height: 0.7 }, captions: { y: 0.885, maxWidth: 0.7, fontSize: 48 } },
	},
};

export const SCENES = {
	studio: {
		label: "Studio",
		images: {},
		anchors: {},
		layout(format, { captions }) {
			return STUDIO_LAYOUT[format][captions ? "captioned" : "plain"];
		},
		// Warm off-white wall fading into a slightly darker floor, with a soft
		// horizon where Stu stands.
		drawBack(ctx, { w, h, layout }) {
			const floorY = layout.stu.footY * h;
			const wall = ctx.createLinearGradient(0, 0, 0, floorY);
			wall.addColorStop(0, "#fbfaf8");
			wall.addColorStop(1, "#f1eee8");
			ctx.fillStyle = wall;
			ctx.fillRect(0, 0, w, h);
			const floor = ctx.createLinearGradient(0, floorY - h * 0.08, 0, h);
			floor.addColorStop(0, "rgba(228, 223, 214, 0)");
			floor.addColorStop(0.35, "rgba(228, 223, 214, 0.9)");
			floor.addColorStop(1, "#e2ddd3");
			ctx.fillStyle = floor;
			ctx.fillRect(0, floorY - h * 0.08, w, h - floorY + h * 0.08);
			// Soft spotlight behind Stu.
			const glow = ctx.createRadialGradient(w * layout.stu.cx, floorY - h * layout.stu.height * 0.45, 0, w * layout.stu.cx, floorY - h * layout.stu.height * 0.45, h * layout.stu.height * 0.75);
			glow.addColorStop(0, "rgba(255, 255, 255, 0.7)");
			glow.addColorStop(1, "rgba(255, 255, 255, 0)");
			ctx.fillStyle = glow;
			ctx.fillRect(0, 0, w, h);
		},
		drawFront: null,
		stuShadow: "rgba(22, 33, 58, 0.28)",
		captionStyle: {
			panel: "rgba(28, 27, 25, 0.82)",
			text: "#ffffff",
			upcoming: "rgba(255, 255, 255, 0.55)",
			current: "#ffd166",
		},
		async load() {},
	},
};

export const DEFAULT_SCENE = "studio";
