# Velo — Product Requirements Document (PRD)

**Version:** 1.1
**Status:** Product direction confirmed
**Product:** Velo
**Tagline:** Save. Convert. Organize.
**Primary MVP platform:** Android (Later for iOS)
**Frontend:** React Native + Expo + TypeScript
**Backend:** Supabase
**Media processing:** Python + yt-dlp + gallery-dl + FFmpeg
**Architecture:** Multi-resolver media platform

---

## 1. Executive Summary

Velo is a modern media source management, downloading, conversion, and organization platform.

Users can provide a supported URL through paste, sharing, clipboard detection, or eventually Velo's own browser. Velo analyzes the source, identifies the platform and available media, presents suitable download options, processes the selected media, and automatically organizes it into the user's library.

Unlike traditional downloader applications, Velo is designed around a persistent Media Source.

The source URL and associated metadata remain stored even when:

- the download fails;
- the user deletes the downloaded file;
- the user wants to download another quality;
- the user wants to open the original source again;
- the user wants to share/copy the source;
- authentication is temporarily required;
- a resolver temporarily fails;
- the user simply wants to save the link for later.

This makes Velo more than a downloader.

**Velo = Media Source Manager + Downloader + Converter + Organizer**

---

## 2. Product Vision

Velo should make saving and managing supported media as simple as:

**One link → Detect → Resolve → Choose → Download → Process → Organize**

while giving power users advanced control over:

- resolver selection;
- format;
- quality;
- conversion;
- organization;
- download queue;
- source history;
- retry behavior;
- customization.

---

## 3. Problem Statement

Existing media downloader applications often have limitations:

- dependence on one extraction engine;
- broken downloads when platforms change;
- limited image support;
- limited format support;
- weak error handling;
- poor retry mechanisms;
- little persistence of source URLs;
- downloaded files become difficult to locate;
- deleting a downloaded file can mean losing the ability to easily find it again;
- limited conversion tools;
- limited organization;
- limited customization;
- technical interfaces that are difficult for ordinary users.

Velo addresses these issues through a combination of:

- Persistent Media Sources
- Multi-resolver architecture
- Download management
- Media processing
- Automatic organization
- Searchable media library
- Modern customizable UI.

---

## 4. Product Definition

Velo is:

> A smart media acquisition, conversion, and organization platform that preserves the relationship between online media sources and locally downloaded content.

The downloaded file is not the end of the workflow.

The source remains useful after the file is gone.

---

## 5. Core Product Model

**Traditional downloader:**

```
URL
 ↓
Download
 ↓
File
 ↓
Done
```

**Velo:**

```
                 MEDIA SOURCE
                      │
          ┌───────────┼───────────┐
          │           │           │
       Metadata      URL       Platform
          │           │           │
          └───────────┼───────────┘
                      │
                 Download(s)
                      │
             ┌────────┼────────┐
             │        │        │
           Video    Audio    Image
             │        │        │
             └────────┼────────┘
                      │
                 Processing
                      │
                 Organization
                      │
                   Library
```

A single source can therefore have multiple download records.

---

## 6. Target Users

### 6.1 Casual users

Users who want to:

- save videos;
- save images;
- extract audio;
- download media without technical complexity.

### 6.2 Power users

Users who want:

- quality selection;
- format selection;
- batch downloads;
- conversion;
- custom organization;
- detailed metadata;
- advanced download controls.

### 6.3 Media collectors

Users who frequently save:

- videos;
- images;
- audio;
- educational content;
- reference material;
- creator content.

---

## 7. Core Product Goals

Velo should:

- Accept supported URLs.
- Detect the platform.
- Detect media type.
- Preserve the source.
- Fetch available metadata.
- Resolve available media.
- Present quality/format choices.
- Download video, image and audio content where supported.
- Extract audio.
- Convert supported media.
- Manage downloads.
- Support background downloading.
- Automatically organize files.
- Provide a searchable library.
- Preserve source history.
- Allow redownload.
- Allow retry of failed sources.
- Allow opening/copying/sharing the original URL.
- Support saving links without downloading.
- Provide intelligent resolver fallback.
- Provide modern customization.
- Provide non-intrusive monetization.

---

## 8. Persistent Media Sources

This is now a core Velo feature.

Every URL entered into Velo can become a persistent Media Source.

The source remains in Velo independently of whether a local file currently exists.

### 8.1 Source Information

Where available, Velo should store:

- original URL;
- canonical URL;
- platform;
- platform media ID;
- creator/channel name;
- creator/channel ID;
- title;
- description;
- thumbnail;
- media type;
- duration;
- published date;
- available metadata;
- first-seen date;
- last-checked date;
- source status.

---

## 9. Save Link

Users should be able to save a source without downloading it.

Example:

```
Share → Velo

┌─────────────────────────────┐
│ How to Build a React App    │
│ Tech Example                │
│ YouTube                     │
│                             │
│ [Download]   [Save Link]    │
└─────────────────────────────┘
```

**Save Link** stores the source and metadata for later.

This allows users to build a personal collection of sources without immediately consuming storage.

---

## 10. Source Actions

Every saved Media Source should eventually provide:

- **Download** — Resolve and download.
- **Redownload** — Download the content again.
- **Retry** — Retry a failed attempt.
- **Open Source** — Open the original/canonical URL.
- **Copy URL** — Copy the URL.
- **Share URL** — Share the source using the operating system share sheet.
- **View Details** — Show source metadata and download history.

---

## 11. Redownload

If a local file is deleted, the source remains.

Example:

```
YouTube Video

Status:
File missing

[Redownload]
[Open Source]
[Copy URL]
```

When the user selects Redownload:

1. Velo retrieves the stored source.
2. Rechecks the source.
3. Resolves the current available media.
4. Compares available formats with the previous download.
5. Allows the user to choose.
6. Creates a new download task.

Velo should not assume the old format still exists.

---

## 12. Previous Download Preference

Velo should remember the previous selection.

Example:

```
Previous:
1080p MP4

Current:
1080p MP4 available

[Download Again]
```

If unavailable:

```
Previous:
1080p MP4

Current:
1080p unavailable
720p available

[Download 720p]
```

---

## 13. Download History

A Media Source can have multiple download records.

Example:

```
YouTube Video
│
├── 1080p MP4
│   └── Completed
│
├── 720p MP4
│   └── Completed
│
└── MP3
    └── Completed
```

The source remains the parent object.

---

## 14. Deleted File Handling

If Velo detects that the local file no longer exists:

```
Media Source
────────────

How to Build a React App

⚠ File unavailable

Downloaded:
11 Sep 2026

[Redownload]
```

The source itself should not be deleted automatically.

This prevents accidental file deletion from destroying the user's source history.

---

## 15. Failed Source Persistence

A failed download should remain available.

Example:

```
⚠ Download Failed

How to Build a React App

Tech Example

Reason:
Authentication required

[Try Again]
[Open Source]
[Copy URL]
[Share]
```

The user can return later.

---

## 16. Failure Types

Velo should classify failures.

Possible categories:

- `AUTH_REQUIRED`
- `PRIVATE`
- `RATE_LIMITED`
- `MEDIA_NOT_FOUND`
- `PROVIDER_CHANGED`
- `FORMAT_UNAVAILABLE`
- `NETWORK_ERROR`
- `UNSUPPORTED`
- `CAPTCHA_REQUIRED`
- `SERVER_ERROR`
- `DRM_PROTECTED`
- `UNKNOWN`

The failure category determines what actions are appropriate.

---

## 17. Retry Behavior

Examples:

| Failure                 | Actions                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| Network error           | `[Retry]`                                                        |
| Authentication required | `[Open Source]` `[Try Again]`                                    |
| Format unavailable      | `[Choose Another Format]`                                        |
| Provider changed        | `[Try Another Resolver]`                                         |
| DRM protected           | Unable to download protected media. `[Open Source]` `[Copy URL]` |

Velo must not use fallback mechanisms to bypass DRM or access controls.

---

## 18. Platform Metadata

Velo should extract useful metadata where the resolver/platform makes it available.

### Example — YouTube

Potential information:

- Title
- Channel name
- Channel ID
- Video ID
- Thumbnail
- Description
- Published date
- Duration
- URL

### Example — Instagram

Potential information:

- Caption/title
- Username
- Profile name
- Post/Reel ID
- Thumbnail
- Media type
- URL

### Generic platforms

Potential information:

- Creator/uploader
- Title
- Media ID
- Thumbnail
- Published date
- Duration
- Media type
- URL

The exact fields depend on platform availability.

---

## 19. URL Management

Velo should maintain:

- Original URL
- Canonical URL
- Last known URL
- URL history

This helps with:

- redirects;
- canonical URLs;
- platform URL changes;
- resolver updates.

Velo should not promise recovery if content has been permanently deleted from the source platform.

---

## 20. Resolver Manager

Velo will use multiple extraction strategies.

Architecture:

```
URL
 ↓
Resolver Manager
 ↓
Best resolver
 ↓
Fallback if appropriate
 ↓
Normalized Media Result
```

---

## 21. Resolver Types

Initial architecture:

- **Direct Resolver** — Direct media URLs.
- **Platform Resolver** — Platform-specific extraction.
- **yt-dlp Resolver** — Broad video/audio support.
- **gallery-dl Resolver** — Image/gallery-oriented extraction.
- **Custom Resolver** — Platform-specific custom logic.
- **URL Shortcut Resolver** — Known URL transformations to supported external resolver services.
- **Browser Resolver** — Future feature.

---

## 22. Resolver Selection

Each resolver should have:

- `id`
- `priority`
- `confidence`
- `health`
- `supported platforms`
- `supported media types`

Example:

```
Instagram Resolver
Confidence: 95

yt-dlp
Confidence: 80

Browser Resolver
Confidence: 70
```

The system should select the most appropriate healthy resolver.

---

## 23. Resolver Fallback

Example:

```
Instagram Resolver
        ↓
    failed
        ↓
PROVIDER_CHANGED
        ↓
yt-dlp Resolver
        ↓
     success
```

Fallback should depend on the failure type.

---

## 24. Media Normalization

All resolver results should be converted into Velo's standard model.

```typescript
type MediaVariant = {
  id: string;
  type: "video" | "audio" | "image";
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  filesize?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  estimatedSize?: number;
};
```

Metadata:

```typescript
type MediaMetadata = {
  title?: string;
  description?: string;
  creator?: string;
  uploader?: string;
  platform?: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  duration?: number;
  album?: string;
  artist?: string;
  trackNumber?: number;
  width?: number;
  height?: number;
  fps?: number;
  mimeType?: string;
  extension?: string;
};
```

---

## 25. Supported Media

### Video

Initial quality targets:

- 360p
- 480p
- 720p
- 1080p
- 1440p
- 2160p

Actual availability depends on the source.

### Audio

Initial:

- MP3
- M4A
- OPUS

### Images

Initial:

- JPG/JPEG
- PNG
- WebP

### Files

Supported architecturally, but not a major MVP priority.

---

## 26. Format Selection

Velo should display available formats clearly.

Example:

```
2160p   4K       1.8 GB
1440p   QHD      950 MB
1080p   Full HD  620 MB
720p    HD       310 MB
480p             180 MB
360p              95 MB
```

Where available:

- resolution;
- FPS;
- codec;
- container;
- audio;
- estimated size.

---

## 27. Smart Quality

Options:

- **Best Quality** — Maximum appropriate quality.
- **Balanced** — Good quality/file-size ratio.
- **Data Saver** — Lower file size.
- **Custom** — Manual selection.

---

## 28. Audio Extraction

Users can choose:

- Download Video
- Extract Audio

Initial formats:

- MP3
- M4A
- OPUS

FFmpeg handles processing.

---

## 29. Download Manager

Velo requires a persistent download queue.

**States:**

- `CREATED`
- `VALIDATING`
- `DETECTING_PLATFORM`
- `RESOLVING`
- `RESOLVED`
- `WAITING_FOR_SELECTION`
- `QUEUED`
- `DOWNLOADING`
- `PROCESSING`
- `ORGANIZING`
- `COMPLETED`

**Additional:**

- `PAUSED`
- `CANCELED`
- `RETRYING`
- `FAILED`
- `AUTH_REQUIRED`
- `UNSUPPORTED`
- `SOURCE_UNAVAILABLE`

---

## 30. Download Controls

Every task should support where applicable:

- Pause
- Resume
- Cancel
- Retry
- Delete
- Open
- Share

---

## 31. Background Downloads

Android MVP should support:

- background downloads;
- notifications;
- pause/resume;
- network changes;
- battery considerations;
- filesystem handling;
- MediaStore.

Native Android implementation should be written in Kotlin.

---

## 32. Media Organization

Default structure:

```
Velo/
├── YouTube/
│   ├── Videos/
│   └── Audio/
│
├── Instagram/
│   ├── Videos/
│   └── Images/
│
├── TikTok/
│   ├── Videos/
│   └── Images/
│
└── Other/
```

---

## 33. Custom Organization

Users can create templates such as:

```
{platform}/{media_type}/{creator}/
```

or:

```
{platform}/{year}/{month}/
```

Supported variables may include:

- platform
- media_type
- creator
- title
- year
- month
- day
- resolution
- extension

---

## 34. File Naming

Examples:

```
{title}
{creator} - {title}
{date} - {title}
```

Velo must sanitize filenames for the target filesystem.

---

## 35. Media Library

Main categories:

- All
- Videos
- Images
- Audio
- Files

Filters:

- platform;
- date;
- size;
- resolution;
- format;
- duration.

---

## 36. Saved Sources Library

This is separate conceptually from downloaded media.

Possible tabs:

```
Library

[Media] [Sources]
```

Sources may show:

- 🟢 Downloaded
- 🟡 File Missing
- 🔵 Failed / Retry Available
- 🔴 Source Unavailable

---

## 37. Search

Search should support:

- title;
- creator;
- filename;
- platform;
- metadata;
- source URL.

---

## 38. Favorites

Users can mark:

**Favorite**

for frequently accessed media or sources.

---

## 39. Duplicate Detection

Velo should attempt to detect duplicates using:

- content hash;
- source URL;
- platform media ID;
- filename;
- metadata.

---

## 40. Conversion Tools

Future Tools section:

- video → audio;
- audio → audio;
- video → video;
- image conversion;
- compression;
- metadata editing.

MVP should keep this limited to core conversion functionality.

---

## 41. Metadata

Where available, Velo should preserve:

- title;
- artist;
- album;
- creator;
- release date;
- track number;
- thumbnail.

---

## 42. UI/UX

Visual direction:

**Modern iOS-inspired glassmorphism**

The interface should remain comfortable and native-feeling on Android.

Characteristics:

- glass cards;
- smooth animations;
- rounded surfaces;
- clean typography;
- subtle gradients;
- responsive layout;
- strong visual hierarchy.

---

## 43. Navigation

Initial:

- Home
- Library
- Downloads
- Tools
- Settings

---

## 44. Home Screen

Example:

```
Welcome

[ Paste a link... ]

[ Analyze ]

Recent downloads

Active downloads

Quick Actions
```

---

## 45. Source Details Screen

This becomes an important screen.

Example:

```
┌─────────────────────────────┐
│          Thumbnail          │
│                             │
│ How to Build React Apps     │
│ Tech Example                │
│ YouTube                     │
│                             │
│ 10 Sep 2026                 │
│ 18:32                       │
│                             │
│ [Download]                  │
│ [Open Source]               │
│ [Copy URL] [Share]          │
│                             │
│ Download History            │
│                             │
│ 1080p MP4    Completed      │
│ MP3          Completed      │
│ 720p MP4     File Missing   │
└─────────────────────────────┘
```

This is one of the areas that distinguishes Velo from a basic downloader.

---

## 46. Customization

Users should eventually be able to customize:

- theme;
- accent;
- appearance;
- glass intensity;
- layout;
- icons;
- organization;
- download behavior.

---

## 47. Themes

Initial:

- Light;
- Dark;
- System.

Future:

- custom themes;
- accent colors;
- glass styles;
- premium theme packs.

---

## 48. Custom App Icons

Future capability:

- built-in icon packs;
- user-selected icon styles;
- custom/generated icons later.

AI-generated icons are not required for MVP.

---

## 49. Monetization

Velo uses a freemium model.

The core product should remain useful for free.

---

## 50. Free Tier

Free users receive:

- basic downloading;
- video;
- image;
- audio;
- basic formats;
- queue;
- basic organization;
- library;
- basic themes.

---

## 51. Advertising

Ads should be:

- light;
- non-intrusive;
- optional where possible.

Avoid:

- constant interstitials;
- ads during downloads;
- blocking basic functionality behind ads.

---

## 52. Rewarded Premium

Confirmed model:

**1 rewarded advertisement = 1 hour Premium.**

Rewards stack.

Example:

```
1 ad → +1 hour
2 ads → +2 hours
3 ads → +3 hours
```

Example UI:

```
Premium active
47 minutes remaining

[Watch Ad +1 Hour]
```

If another ad is watched:

```
1h 47m remaining
```

rather than resetting the timer.

---

## 53. Reward Limits

Initial proposal:

**3–5 rewarded Premium hours per day.**

The final limit can be adjusted through backend feature flags.

---

## 54. Paid Premium

Potential Premium benefits:

- no ads;
- advanced formats;
- batch downloads;
- advanced conversion;
- higher processing priority;
- advanced organization;
- premium themes;
- premium icons;
- cloud sync;
- advanced tools.

Premium should provide power and convenience rather than locking basic functionality.

---

## 55. Entitlement System

Generic entitlement API:

```typescript
hasEntitlement("premium");
```

Sources:

- subscription
- rewarded_ad
- promotion
- admin

Backend example:

```
user_id
feature
enabled
source
expires_at
```

---

## 56. Reward Verification

Rewarded ads must be verified by the backend.

Flow:

```
Ad Network
    ↓
Verified Reward
    ↓
Backend
    ↓
premium_until += 1 hour
    ↓
App
```

The client must not be trusted to grant its own rewards.

---

## 57. Technical Architecture

### Frontend

- React Native
- TypeScript
- Zustand
- React Navigation
- Reanimated
- Gesture Handler
- SQLite/local persistence

---

## 58. Native Layer

### Android

Kotlin:

- Download Service
- Notification Manager
- Share Intent
- Clipboard
- MediaStore
- Filesystem
- Network Monitor
- Battery Handling

### iOS

Swift:

- URLSession
- Share Extension
- Files
- Notifications
- Filesystem
- Lifecycle

---

## 59. Native Download Interface

```typescript
interface NativeDownloadEngine {
  enqueue(job: NativeDownloadJob): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  getStatus(id: string): Promise<DownloadStatus>;
}
```

---

## 60. Backend

Supabase acts as the control plane.

```
Supabase
│
├── Auth
├── PostgreSQL
├── RLS
├── Realtime
├── Edge Functions
├── Queues
├── Storage
└── Feature Flags
```

---

## 61. Python Worker

Heavy processing runs outside Supabase Edge Functions.

```
Supabase Queue
      ↓
Python Worker
      ↓
Resolver Manager
      ↓
yt-dlp
gallery-dl
FFmpeg
Custom Resolvers
```

Technology:

- Python;
- FastAPI;
- Docker;
- yt-dlp;
- gallery-dl;
- FFmpeg.

---

## 62. Processing Strategy

Prefer:

```
Resolver
 ↓
Direct media URL
 ↓
Mobile device
 ↓
Local storage
```

instead of unnecessarily routing every large media file through the backend.

Cloud processing can be used where required.

---

## 63. Database Architecture

Important tables:

- profiles
- settings
- devices

- media_sources
- source_urls
- source_metadata
- source_history

- downloads
- download_items
- download_attempts

- media
- media_variants
- media_metadata

- resolvers
- resolver_health
- resolver_capabilities

- providers
- provider_configs

- folders
- organization_rules

- conversion_jobs
- queue_jobs

- usage
- feature_flags

- subscriptions
- entitlements
- ad_rewards
- credit_transactions

The exact schema will be finalized in the Technical Specification.

---

## 64. Important Database Relationship

The most important new relationship is:

```
MEDIA_SOURCE
     │
     ├── source_urls
     ├── metadata
     ├── source history
     │
     └── DOWNLOADS
             │
             ├── 1080p MP4
             ├── 720p MP4
             └── MP3
```

This prevents downloaded files from becoming the only record of the source.

---

## 65. Media Source Example

Conceptually:

```
MediaSource
──────────────
id
user_id

original_url
canonical_url
platform
platform_media_id

creator_id
creator_name
title
description
thumbnail_url

media_type

first_seen_at
last_checked_at

status
```

Download:

```
Download
──────────────
id
source_id

variant
filename
local_uri
filesize

status

created_at
completed_at
deleted_at
```

---

## 66. Privacy

Velo should minimize unnecessary collection.

Analytics can track:

- platform;
- media type;
- resolver success/failure;
- feature usage;
- rewarded-ad engagement;
- subscription conversion;
- performance.

Velo should avoid unnecessarily uploading or retaining users' actual media.

---

## 67. Security

Required:

- Supabase RLS;
- secure authentication;
- user-specific data access;
- signed URLs where appropriate;
- backend reward verification;
- secure provider configuration;
- protected entitlement state;
- minimal server-side media retention.

---

## 68. Compliance Boundaries

Velo should be designed for media users are authorized to save.

It should not intentionally bypass:

- DRM;
- private content restrictions;
- authentication controls;
- access controls.

Velo should avoid claims such as:

> "Download anything from anywhere."

Preferred positioning:

> Download supported media you have permission to save.

---

## 69. MVP Scope

### Input

- Paste URL;
- Share URL;
- Clipboard detection;
- Save Link.

### Source Management

- persistent source records;
- source metadata;
- original URL;
- canonical URL where available;
- Open Source;
- Copy URL;
- Share URL;
- source details;
- source history.

### Download

- video;
- image;
- audio;
- format selection;
- queue;
- pause;
- resume;
- cancel;
- retry;
- background downloads.

### Resolver

- Direct Resolver;
- yt-dlp;
- gallery-dl;
- initial custom resolver architecture;
- intelligent fallback;
- failure classification.

### Organization

- platform folders;
- media-type folders;
- filename templates.

### Library

- media;
- saved sources;
- search;
- basic filtering;
- favorites;
- missing-file detection.

### Conversion

- audio extraction;
- MP3;
- M4A;
- OPUS.

### UI

- modern glass-inspired UI;
- light/dark/system;
- basic customization.

### Monetization

- light ads;
- rewarded ads;
- 1-hour Premium reward;
- stackable Premium time.

### Backend

- Supabase;
- authentication;
- database;
- queue;
- worker communication;
- entitlement system.

---

## 70. Deferred Features

After MVP:

- built-in browser;
- Browser Resolver;
- extensive provider-specific resolvers;
- advanced batch processing;
- advanced media editing;
- cloud media storage;
- full cross-device media synchronization;
- AI media tagging;
- AI-generated icons;
- advanced compression;
- advanced metadata editing;
- large theme marketplace;
- advanced subscription tiers.

---

## 71. Future Built-in Browser

The built-in browser is a future feature, not MVP.

Potential experience:

```
Velo Browser
      ↓
User browses supported website
      ↓
Velo detects supported media
      ↓
"Save with Velo"
      ↓
Media Source
      ↓
Download
```

This could eventually integrate directly with the Resolver Manager.

---

## 72. Success Metrics

### Activation

Percentage of users who successfully complete their first download.

### Primary technical KPI

**Successful Download Rate**

Track:

- Initial resolver success
- Fallback success
- Complete failure

### Other metrics

- D1 retention;
- D7 retention;
- D30 retention;
- downloads/user;
- sources saved/user;
- redownload usage;
- retry success;
- resolver success rate;
- average resolution time;
- conversion usage;
- library usage;
- rewarded ads;
- Premium conversion.

---

## 73. Key Product Differentiator

Velo should not compete simply by having more buttons.

Its major differentiation is:

**Persistent Sources + Resolver Intelligence + Organization + UX**

Traditional:

```
URL
 ↓
Downloader
 ↓
File
```

Velo:

```
URL
 ↓
Persistent Media Source
 ↓
Metadata
 ↓
Resolver Manager
 ↓
Format Selection
 ↓
Download
 ↓
Processing
 ↓
Organization
 ↓
Library
 ↓
Source remains available
 ↓
Redownload / Retry / Open / Share
```

---

## 74. Complete Velo User Journey

### Normal download

```
User finds media
       ↓
Share → Velo
       ↓
Source created
       ↓
Platform detected
       ↓
Metadata fetched
       ↓
Media resolved
       ↓
Format selected
       ↓
Download
       ↓
Processing
       ↓
Organization
       ↓
Library
```

### File accidentally deleted

```
Library
   ↓
File missing
   ↓
Source still exists
   ↓
Redownload
   ↓
Resolve again
   ↓
Download
```

### Download fails

```
Source created
       ↓
Resolve
       ↓
Failure
       ↓
Source preserved
       ↓
User returns later
       ↓
Retry / Open / Copy / Share
```

### Save for later

```
Share → Velo
       ↓
Save Link
       ↓
Source stored
       ↓
No download
       ↓
Later:
Download
```

---

## 75. Final Product Architecture

```
                         VELO
                          │
          ┌───────────────┴────────────────┐
          │                                │
    MEDIA SOURCES                      LIBRARY
          │                                │
    ┌─────┼─────┐                    ┌────┼────┐
    │     │     │                    │    │    │
   URL  Metadata History           Video Image Audio
    │
    ▼
RESOLVER MANAGER
    │
    ├── Direct Resolver
    ├── Platform Resolver
    ├── yt-dlp
    ├── gallery-dl
    ├── Custom Resolver
    ├── URL Shortcut
    └── Browser (future)
    │
    ▼
MEDIA RESULT
    │
    ├── Video
    ├── Image
    └── Audio
    │
    ▼
DOWNLOAD ENGINE
    │
    ├── Queue
    ├── Background
    ├── Pause
    ├── Resume
    ├── Retry
    └── Recovery
    │
    ▼
PROCESSING
    │
    └── FFmpeg
    │
    ▼
ORGANIZATION
    │
    ├── Platform
    ├── Media Type
    └── Custom Rules
    │
    ▼
LOCAL MEDIA LIBRARY
```

---

## 76. Final Product Definition

The official Velo definition should now be:

> Velo is a smart media source manager, downloader, converter, and organizer that preserves the relationship between online media sources and locally stored content. It uses multiple extraction engines and intelligent resolver fallback to provide reliable media acquisition while giving users persistent source history, redownload, retry, organization, conversion, and library management.

### Core philosophy

> **The file can disappear. The source doesn't have to.**

And the core user experience remains:

> **Save. Convert. Organize.**

---

## PRD Status

**Velo PRD v1.1 — COMPLETE**

The product requirements are now sufficiently defined to move into the next document:

**Velo Technical Specification (TSD) v1.0**

That document should translate this PRD into actual implementation details, including:

- Complete Supabase database schema
- media_sources / source_urls / download relationships
- REST/API contracts
- Resolver interfaces
- Resolver Manager algorithm
- Failure and fallback logic
- Download state machine
- Queue/job payloads
- React Native project/folder architecture
- Android Kotlin native modules
- Python worker architecture
- yt-dlp/gallery-dl/FFmpeg integration
- Media library implementation
- Persistent source/redownload system
- Rewarded Premium entitlement architecture
- Exact MVP development sequence

That TSD is the appropriate next step because we now have a stable product definition rather than continuing to change the PRD.
