from PIL import Image
import sys

try:
    img = Image.open('build/icon.png')
    bbox = img.getbbox()
    print('Original size:', img.size)
    print('Bounding box:', bbox)
    if bbox:
        cropped = img.crop(bbox)
        padding = int(max(cropped.size) * 0.05)
        new_size = (cropped.size[0] + 2*padding, cropped.size[1] + 2*padding)
        final_img = Image.new('RGBA', new_size, (0, 0, 0, 0))
        final_img.paste(cropped, (padding, padding))
        final_img.save('build/icon.png')
        print('Cropped and saved new size:', final_img.size)
    else:
        print('No bounding box found (empty image?)')
except ImportError:
    print('Pillow is not installed. Please run: pip install Pillow')
except Exception as e:
    print('Error:', e)
