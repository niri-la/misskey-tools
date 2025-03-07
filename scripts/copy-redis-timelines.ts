/**
 * This script copies misskey redis timeslines (FTT) to another redis instance.
 * 
 * This will process:
 * - some FTT timelines.
 *   FTT Timelines are implemented with redis list so we can prepend items so no limitation
 *   You can select timelines to recover by specifying the timeline name in the fttTimelines array.
 *   if '*' is a part of the timeline name, it will be treated as a wildcard.
 * - Notification timeline iff the timeline is empty.
 *   Notification is implemented as stream so we can't prepend items.
 *   If the timeline is empty we can copy the timeline.
 */

import * as Redis from 'ioredis';

const keyPrefix = process.env.KEY_PREFIX;

const sourceHost = process.env.SOURCE_HOST;
const sourcePort = process.env.SOURCE_PORT;

const destHost = process.env.DEST_HOST;
const destPort = process.env.DEST_PORT;

const fttTimelines = [
  'antennaTimeline:*'
];

const notificationTimeline = true;

const dryRun = true;

////////

if (!sourceHost || !sourcePort) {
  console.error('Please set SOURCE_HOST, SOURCE_PORT');
  process.exit(1);
}

if (!keyPrefix) {
  console.error('Please set KEY_PREFIX');
  process.exit(1);
}

const sourceRedis = new Redis.Redis({
  host: sourceHost,
  port: parseInt(sourcePort),
});


let destRedis: Redis.Redis;

if (!(!destHost || !destPort)) {
  destRedis = new Redis.Redis({
    host: destHost,
    port: parseInt(destPort),
  });
}

if (!dryRun && !destRedis) {
  console.error('Please set DEST_HOST, DEST_PORT');
  process.exit(1);
}

if (fttTimelines.length != 0) {
  const fttTimelineKeys = [];

  for (let fttTimeline of fttTimelines) {
    if (fttTimeline.includes('*')) {
      fttTimelineKeys.push(...await sourceRedis.keys(keyPrefix + 'list:' + fttTimeline));
    } else {
      fttTimelineKeys.push(keyPrefix + 'list:' + fttTimeline);
    }
  }

  console.log('FTT Timelines:', fttTimelineKeys);

  await Promise.all(fttTimelineKeys.map(async key => {
    const values = await sourceRedis.lrange(key, 0, -1);
    console.log('Copying', key, values.length, 'items', values);
    if (!dryRun) {
      await destRedis.rpush(keyPrefix + key, ...values);
    }
  }));
}

if (notificationTimeline) {
  const keys = await sourceRedis.keys(keyPrefix + 'notificationTimeline:*');
  console.log('notification timelines:', keys);
  await Promise.all(keys.map(async key => {
    const values = await sourceRedis.xrange(key, '-', '+');
    console.log('Copying', key, values.length, 'items', values);
    if (destRedis) {
      const count = await destRedis.xlen(key);
      if (count != 0) {
        console.log('Destination timeline is not empty:', key);
        return;
      }

      if (!dryRun) {
        // if the destination timeline is empty, copy the timeline
        // if not empty, we may experience error on xadd so do not
        for (const [id, fields] of values) {
          await destRedis.xadd(keyPrefix + key, id, ...fields);
        }
      }
    }
  }));
}

sourceRedis.disconnect();
destRedis?.disconnect();
