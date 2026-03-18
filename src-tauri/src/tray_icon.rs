use image::{ImageBuffer, Rgba, RgbaImage};

const ICON_SIZE: u32 = 32;

fn level_color(percent: f64, is_error: bool) -> (u8, u8, u8) {
    if is_error {
        return (140, 140, 140);
    }
    if percent < 50.0 {
        (76, 175, 80)
    } else if percent < 80.0 {
        (255, 193, 7)
    } else if percent < 95.0 {
        (255, 152, 0)
    } else {
        (244, 67, 54)
    }
}

pub fn create_usage_icon(session_percent: f64, weekly_percent: f64, is_error: bool) -> Vec<u8> {
    let mut img: RgbaImage = ImageBuffer::new(ICON_SIZE, ICON_SIZE);

    for pixel in img.pixels_mut() {
        *pixel = Rgba([0, 0, 0, 0]);
    }

    let bg = if is_error {
        Rgba([70, 70, 70, 220])
    } else {
        Rgba([60, 60, 70, 255])
    };
    for y in 2..ICON_SIZE - 2 {
        for x in 2..ICON_SIZE - 2 {
            img.put_pixel(x, y, bg);
        }
    }

    let bar_left = 4u32;
    let bar_right = ICON_SIZE - 4;
    let bar_width = bar_right - bar_left;

    let session_fill = ((session_percent.clamp(0.0, 100.0) / 100.0) * bar_width as f64) as u32;
    let weekly_fill = ((weekly_percent.clamp(0.0, 100.0) / 100.0) * bar_width as f64) as u32;

    let (sr, sg, sb) = level_color(session_percent, is_error);
    let (wr, wg, wb) = level_color(weekly_percent, is_error);

    for y in 8..15 {
        for x in bar_left..bar_right {
            img.put_pixel(x, y, Rgba([80, 80, 90, 255]));
        }
    }
    for y in 8..15 {
        for x in bar_left..(bar_left + session_fill).min(bar_right) {
            img.put_pixel(x, y, Rgba([sr, sg, sb, 255]));
        }
    }

    for y in 18..23 {
        for x in bar_left..bar_right {
            img.put_pixel(x, y, Rgba([80, 80, 90, 255]));
        }
    }
    for y in 18..23 {
        for x in bar_left..(bar_left + weekly_fill).min(bar_right) {
            img.put_pixel(x, y, Rgba([wr, wg, wb, 255]));
        }
    }

    img.into_raw()
}
