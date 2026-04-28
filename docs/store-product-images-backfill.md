# Store Product Image Backfill

Existing `store_products.image_url` values remain supported as `legacy_image_url` and are included in `image_urls` ahead of uploaded images.

Backfill policy:

1. Leave remote URLs in `image_url` until the source image is manually reviewed.
2. For each product, upload the approved source image through the admin product image uploader.
3. Save the product with the uploaded image first in order.
4. Clear `image_url` only after the normalized uploaded image is `ready`.
5. Archive any source image that fails normalization rather than keeping it associated with the product.

This avoids fetching arbitrary remote URLs from backend jobs and keeps the normalized product image pipeline limited to files intentionally uploaded by an admin.
