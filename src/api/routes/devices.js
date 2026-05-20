const express = require('express');
const router  = express.Router();
const { getAllDevices, updateThresholds, assignDeviceToZone } = require('../../services/deviceService');

// GET /api/devices
router.get('/', async (req, res) => {
  try {
    const devices = await getAllDevices();
    res.json({ success: true, data: devices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/devices/:id/thresholds
router.put('/:id/thresholds', async (req, res) => {
  try {
    const { safety_threshold, warning_threshold, danger_threshold } = req.body;
    if (safety_threshold === undefined || warning_threshold === undefined || danger_threshold === undefined) {
      return res.status(400).json({ success: false, message: 'safety_threshold, warning_threshold and danger_threshold required' });
    }
    if (parseFloat(safety_threshold) >= parseFloat(warning_threshold)) {
      return res.status(400).json({ success: false, message: 'safety_threshold must be less than warning_threshold' });
    }
    if (parseFloat(warning_threshold) >= parseFloat(danger_threshold)) {
      return res.status(400).json({ success: false, message: 'warning_threshold must be less than danger_threshold' });
    }
    const updated = await updateThresholds(req.params.id, safety_threshold, warning_threshold, danger_threshold);
    if (!updated) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/devices/:id/zone
router.put('/:id/zone', async (req, res) => {
  try {
    const { zone_id } = req.body;
    if (zone_id === undefined) {
      return res.status(400).json({ success: false, message: 'zone_id required' });
    }
    const updated = await assignDeviceToZone(req.params.id, zone_id);
    if (!updated) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
