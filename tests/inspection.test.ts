import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { DEVICE_MODELS, getDeviceModel, type ModelDefinition } from '../src/inspection/catalog';
import { buildDeviceModel } from '../src/inspection/models';

const devices = CAMPAIGN_CASES.flatMap((level) => [...level.equipment]);
const availableModels = (): ModelDefinition[] => [...new Map(devices.map(getDeviceModel).filter((model): model is ModelDefinition => model !== null).map((model) => [model.id, model])).values()];

describe('local real 3D equipment models', () => {
  it('maps ten device kinds to real implemented models and leaves ordinary documents without fictitious 3D', () => {
    const expected = {
      'pc-bank': 'tower', 'monitor-bank': 'monitor', projector: 'projector', lighting: 'lamp',
      'kitchen-fridge': 'fridge', 'kitchen-freezer': 'fridge', 'thermal-controller': 'radiator',
      'thermal-window-a': 'window', network: 'network', 'hall-sensor': 'sensor', 'kitchen-extractor': 'ventilation',
    };
    for (const [deviceId, modelId] of Object.entries(expected)) {
      const device = devices.find((candidate) => candidate.id === deviceId)!;
      assert.ok(device, deviceId);
      assert.equal(getDeviceModel(device)?.id, modelId, deviceId);
    }
    assert.equal(availableModels().length, 10);
    assert.deepEqual(availableModels().map((model) => model.id).sort(), Object.keys(DEVICE_MODELS).sort());
    for (const device of devices.filter((candidate) => candidate.category === 'document' && candidate.id !== 'hall-sensor')) {
      assert.equal(getDeviceModel(device), null, device.id);
    }
  });

  it('does not model final-case combined passports as individual physical devices', () => {
    for (const device of devices.filter((candidate) => candidate.id.startsWith('final-'))) {
      assert.equal(getDeviceModel(device)?.id ?? null, device.id === 'final-server' ? 'network' : null, device.id);
    }
  });

  it('does not invent electrical consumption for thermal explanations and the sensor inspection document', () => {
    for (const deviceId of ['thermal-controller', 'thermal-window-a', 'hall-sensor']) {
      const device = devices.find((candidate) => candidate.id === deviceId)!;
      assert.equal(device.mode.powerWatts, 0);
      const model = getDeviceModel(device)!;
      assert.ok(model.parts.every((part) => part.powerShare === 0));
    }
    const sensor = DEVICE_MODELS.sensor;
    assert.match(sensor.name, /документа/);
    assert.match(sensor.parts.find((part) => part.id === 'board')!.description, /не утверждение/);
  });

  it('uses an explicit conserved educational power split rather than adding energy', () => {
    for (const definition of availableModels()) {
      assert.ok(definition.parts.length >= 3, definition.id);
      assert.equal(new Set(definition.parts.map((part) => part.id)).size, definition.parts.length);
      let sum = 0;
      for (const part of definition.parts) {
        assert.ok(Number.isFinite(part.powerShare) && part.powerShare >= 0 && part.powerShare <= 1, `${definition.id}/${part.id}`);
        assert.ok(part.name.length > 2 && part.description.length > 20);
        sum += part.powerShare;
      }
      const passive = definition.id === 'window' || definition.id === 'radiator' || definition.id === 'sensor';
      assert.ok(Math.abs(sum - (passive ? 0 : 1)) < 1e-12, `${definition.id}: share total ${sum}`);
    }
  });

  it('constructs actual volumetric selectable meshes with finite normalized bounds', () => {
    for (const definition of availableModels()) {
      const model = buildDeviceModel(definition);
      assert.ok(model.group instanceof THREE.Group);
      assert.deepEqual([...model.parts.keys()].sort(), definition.parts.map((part) => part.id).sort());
      const bounds = new THREE.Box3().setFromObject(model.group);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      assert.ok([size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0.05), definition.id);
      assert.ok(size.x < 4 && size.y < 4 && size.z < 4, definition.id);
      assert.ok(center.length() < 1e-9, `${definition.id} must rotate about its center`);
      for (const [partId, meshes] of model.parts) {
        assert.ok(meshes.length > 0, `${definition.id}/${partId}`);
        for (const mesh of meshes) {
          assert.ok(mesh instanceof THREE.Mesh);
          assert.equal(mesh.userData.partId, partId);
          const meshSize = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
          assert.ok([meshSize.x, meshSize.y, meshSize.z].every((value) => Number.isFinite(value) && value > 0), `${definition.id}/${partId} must have volume`);
        }
      }
      model.dispose();
    }
  });

  it('allows selection highlights without changing materials of unrelated components', () => {
    for (const definition of availableModels()) {
      const model = buildDeviceModel(definition);
      const materialParts = new Map<THREE.Material, string>();
      for (const [partId, meshes] of model.parts) for (const mesh of meshes) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          assert.ok(!materialParts.has(material) || materialParts.get(material) === partId, `${definition.id}: material shared across ${partId}`);
          materialParts.set(material, partId);
        }
      }
      model.dispose();
    }
  });

  it('disposes every shared geometry and material once, including repeat closing', () => {
    for (const definition of availableModels()) {
      const model = buildDeviceModel(definition);
      const resources = new Set<THREE.BufferGeometry | THREE.Material>();
      model.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        resources.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
      });
      const disposals = new Map<THREE.BufferGeometry | THREE.Material, number>();
      for (const resource of resources) resource.addEventListener('dispose', () => disposals.set(resource, (disposals.get(resource) ?? 0) + 1));
      model.dispose();
      model.dispose();
      assert.equal(model.group.children.length, 0);
      assert.equal(model.parts.size, 0);
      assert.equal(disposals.size, resources.size, definition.id);
      for (const count of disposals.values()) assert.equal(count, 1, `${definition.id}: shared resource disposed more than once`);
    }
  });
});
