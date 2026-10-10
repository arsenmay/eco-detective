import * as THREE from 'three';
import type { ModelDefinition } from './catalog';

export type BuiltDeviceModel = { group: THREE.Group; parts: Map<string, THREE.Mesh[]>; dispose: () => void };
type Color = THREE.ColorRepresentation;
type MaterialOptions = { color: Color; metalness?: number; roughness?: number; emissive?: Color; opacity?: number };

/** Local low-poly engineering models; no textures, files or remote assets. */
export function buildDeviceModel(definition: ModelDefinition): BuiltDeviceModel {
  const factory = new ModelFactory(definition);
  switch (definition.id) {
    case 'tower': buildTower(factory); break;
    case 'monitor': buildMonitor(factory); break;
    case 'projector': buildProjector(factory); break;
    case 'lamp': buildLamp(factory); break;
    case 'fridge': buildFridge(factory); break;
    case 'radiator': buildRadiator(factory); break;
    case 'window': buildWindow(factory); break;
    case 'network': buildNetwork(factory); break;
    case 'sensor': buildSensor(factory); break;
    case 'ventilation': buildVentilation(factory); break;
  }
  return factory.finish();
}

class ModelFactory {
  readonly group = new THREE.Group();
  readonly parts = new Map<string, THREE.Mesh[]>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private disposed = false;

  constructor(definition: ModelDefinition) {
    this.group.name = definition.name;
    for (const part of definition.parts) this.parts.set(part.id, []);
  }
  box(part: string, size: [number, number, number], position: [number, number, number], options: MaterialOptions, rotation?: [number, number, number]): THREE.Mesh {
    const geometry = this.geometry('box-unit', () => new THREE.BoxGeometry(1, 1, 1));
    const mesh = this.mesh(part, geometry, position, options);
    mesh.scale.set(...size);
    if (rotation) mesh.rotation.set(...rotation);
    return mesh;
  }
  cylinder(part: string, radius: number, depth: number, position: [number, number, number], options: MaterialOptions, rotation: [number, number, number] = [Math.PI / 2, 0, 0]): THREE.Mesh {
    return this.orientedMesh(part, this.geometry(`cylinder-${radius}-${depth}`, () => new THREE.CylinderGeometry(radius, radius, depth, 24)), position, options, rotation);
  }
  ring(part: string, radius: number, thickness: number, position: [number, number, number], options: MaterialOptions, rotation: [number, number, number] = [0, 0, 0]): THREE.Mesh {
    return this.orientedMesh(part, this.geometry(`ring-${radius}-${thickness}`, () => new THREE.TorusGeometry(radius, thickness, 8, 28)), position, options, rotation);
  }
  sphere(part: string, radius: number, position: [number, number, number], options: MaterialOptions, scale: [number, number, number] = [1, 1, 1]): THREE.Mesh {
    const mesh = this.mesh(part, this.geometry(`sphere-${radius}`, () => new THREE.SphereGeometry(radius, 24, 12)), position, options);
    mesh.scale.set(...scale);
    return mesh;
  }
  cable(part: string, points: [number, number, number][], radius: number, options: MaterialOptions): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const geometry = new THREE.TubeGeometry(curve, 24, radius, 5, false);
    this.geometries.set(`cable-${this.geometries.size}`, geometry);
    return this.mesh(part, geometry, [0, 0, 0], options);
  }
  private orientedMesh(part: string, geometry: THREE.BufferGeometry, position: [number, number, number], options: MaterialOptions, rotation: [number, number, number]): THREE.Mesh {
    const mesh = this.mesh(part, geometry, position, options);
    mesh.rotation.set(...rotation);
    return mesh;
  }
  private geometry(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.geometries.get(key);
    if (!geometry) { geometry = create(); this.geometries.set(key, geometry); }
    return geometry;
  }
  private mesh(part: string, geometry: THREE.BufferGeometry, position: [number, number, number], options: MaterialOptions): THREE.Mesh {
    if (!this.parts.has(part)) throw new Error(`Unknown model part: ${part}`);
    // Material cache includes partId. Highlighting CPU never tints PSU or fans.
    const key = `${part}:${options.color}:${options.metalness ?? 0}:${options.roughness ?? 0.55}:${options.emissive ?? 0}:${options.opacity ?? 1}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: options.color, metalness: options.metalness ?? 0, roughness: options.roughness ?? 0.55,
        emissive: options.emissive ?? 0x000000, emissiveIntensity: options.emissive ? 0.3 : 0,
        transparent: options.opacity !== undefined && options.opacity < 1, opacity: options.opacity ?? 1,
        depthWrite: options.opacity === undefined || options.opacity >= 1,
      });
      this.materials.set(key, material); this.ownedMaterials.add(material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = !(options.opacity !== undefined && options.opacity < 1);
    mesh.receiveShadow = true;
    mesh.userData.partId = part;
    // Glass is visual only: ray selection reaches the actual internal parts.
    if (options.opacity !== undefined && options.opacity < 0.3) mesh.raycast = () => undefined;
    this.parts.get(part)?.push(mesh);
    this.group.add(mesh);
    return mesh;
  }
  finish(): BuiltDeviceModel {
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.group);
    const center = bounds.getCenter(new THREE.Vector3());
    this.group.children.forEach((child) => child.position.sub(center));
    this.group.updateMatrixWorld(true);
    return { group: this.group, parts: this.parts, dispose: () => {
      if (this.disposed) return;
      this.disposed = true;
      for (const geometry of this.geometries.values()) geometry.dispose();
      for (const material of this.ownedMaterials) material.dispose();
      this.group.clear(); this.parts.clear(); this.materials.clear(); this.geometries.clear(); this.ownedMaterials.clear();
    } };
  }
}

function buildTower(f: ModelFactory): void {
  const shell = { color: 0x274052, metalness: 0.58, roughness: 0.37 };
  const edge = { color: 0x607b87, metalness: 0.72, roughness: 0.26 };
  const dark = { color: 0x112832, metalness: 0.35, roughness: 0.68 };
  const silver = { color: 0xa5b9ba, metalness: 0.84, roughness: 0.3 };
  // Open right side: a transparent acrylic panel reveals genuine volume inside.
  f.box('board', [1.34, 0.07, 1.4], [0, -1.12, 0], shell);
  f.box('board', [1.34, 0.07, 1.4], [0, 1.12, 0], shell);
  f.box('board', [0.06, 2.2, 1.4], [-0.64, 0, 0], shell);
  f.box('board', [1.34, 2.2, 0.05], [0, 0, -0.68], shell);
  f.box('board', [0.035, 2.11, 1.3], [0.69, 0, 0], { color: 0x9de7db, roughness: 0.15, metalness: 0.06, opacity: 0.13 });
  for (const x of [-0.62, 0.62]) for (const z of [-0.62, 0.62]) f.box('board', [0.055, 2.15, 0.055], [x, 0, z], edge);
  for (const x of [-0.47, 0.47]) for (const z of [-0.45, 0.45]) f.box('board', [0.17, 0.11, 0.19], [x, -1.2, z], dark);
  // Front panel has visible openings, fans and controls instead of a flat card.
  for (const x of [-0.59, 0.59]) f.box('board', [0.12, 2.1, 0.06], [x, -0.03, 0.71], shell);
  for (const y of [-1.04, 1.01]) f.box('board', [1.17, 0.12, 0.07], [0, y, 0.71], shell);
  f.box('board', [1.14, 0.24, 0.08], [0, 0.88, 0.71], edge);
  f.cylinder('board', 0.055, 0.03, [-0.4, 0.88, 0.77], { color: 0x7ff3d6, metalness: 0.3, emissive: 0x1d9780 });
  f.box('board', [0.17, 0.037, 0.026], [-0.16, 0.88, 0.765], dark);
  f.box('board', [0.17, 0.037, 0.026], [0.12, 0.88, 0.765], dark);
  // Motherboard, RAM sticks, tiny chips and a gold-trace bus.
  f.box('board', [0.045, 1.55, 1.07], [-0.5, 0.23, -0.03], { color: 0x285953, roughness: 0.68 });
  for (let i = 0; i < 2; i += 1) {
    f.box('board', [0.09, 0.82, 0.08], [-0.43, 0.42, 0.36 - i * 0.16], { color: 0x173d37, roughness: 0.64 });
    for (let j = 0; j < 5; j += 1) f.box('board', [0.025, 0.08, 0.07], [-0.37, 0.14 + j * 0.13, 0.36 - i * 0.16], dark);
    f.box('board', [0.024, 0.77, 0.024], [-0.37, 0.43, 0.36 - i * 0.16], { color: 0x7ad2b5, emissive: 0x21684c, roughness: 0.45 });
  }
  for (let i = 0; i < 5; i += 1) f.box('board', [0.016, 0.013, 0.68], [-0.468, -0.3 + i * 0.055, -0.03], { color: 0xc5b887, metalness: 0.64 });
  f.box('board', [0.38, 0.2, 0.76], [-0.23, -0.39, -0.08], { color: 0x344a57, metalness: 0.45, roughness: 0.44 });
  f.box('board', [0.03, 0.3, 0.46], [-0.455, -0.34, -0.34], dark);
  // CPU package and real extruded radiator fins, visible through the cutaway.
  f.box('cpu', [0.11, 0.41, 0.42], [-0.385, 0.43, -0.13], { color: 0xc3c5b7, metalness: 0.77, roughness: 0.24 });
  f.box('cpu', [0.15, 0.49, 0.49], [-0.29, 0.43, -0.13], silver);
  for (let i = 0; i < 8; i += 1) f.box('cpu', [0.34, 0.04, 0.48], [-0.1, 0.22 + i * 0.06, -0.13], silver);
  f.ring('cpu', 0.235, 0.032, [0.1, 0.43, -0.13], { color: 0x658d9a, metalness: 0.42 }, [0, Math.PI / 2, 0]);
  f.cylinder('cpu', 0.082, 0.07, [0.14, 0.43, -0.13], { color: 0x406a77, metalness: 0.47 }, [0, 0, Math.PI / 2]);
  for (let i = 0; i < 7; i += 1) {
    const angle = i / 7 * Math.PI * 2;
    f.box('cpu', [0.032, 0.12, 0.052], [0.145, 0.43 + Math.cos(angle) * 0.135, -0.13 + Math.sin(angle) * 0.135], dark, [angle, 0, 0]);
  }
  // PSU compartment with cooling grille and bundled power cables.
  f.box('psu', [1.11, 0.42, 1.18], [0, -0.84, -0.04], { color: 0x445763, metalness: 0.55, roughness: 0.47 });
  f.box('psu', [0.024, 0.23, 0.36], [0.567, -0.84, -0.04], { color: 0xb8cabd, roughness: 0.74 });
  for (let i = 0; i < 6; i += 1) f.box('psu', [0.62, 0.017, 0.026], [-0.08, -0.91 + i * 0.035, 0.564], dark);
  for (let i = 0; i < 3; i += 1) f.cable('psu', [[0.21 + i * 0.033, -0.6, -0.31], [0.33 + i * 0.033, -0.16, -0.41], [0.25 + i * 0.033, 0.17, -0.36], [-0.36, 0.15 + i * 0.04, -0.34]], 0.013, { color: [0x548c91, 0xafa17a, 0x315361][i], roughness: 0.77 });
  // Three front fans with rings, hubs and individual low-poly blades.
  for (const y of [-0.56, 0.06, 0.62]) {
    f.ring('fans', 0.246, 0.028, [0, y, 0.725], { color: 0x6ad4c2, metalness: 0.3, emissive: 0x215f58 });
    f.ring('fans', 0.21, 0.013, [0, y, 0.713], dark);
    f.cylinder('fans', 0.07, 0.055, [0, y, 0.747], { color: 0x72939d, metalness: 0.55 });
    for (let i = 0; i < 7; i += 1) {
      const angle = i / 7 * Math.PI * 2;
      f.box('fans', [0.14, 0.063, 0.02], [Math.cos(angle) * 0.13, y + Math.sin(angle) * 0.13, 0.742], { color: 0x344f5c, metalness: 0.47 }, [0, 0, angle + 0.44]);
    }
  }
}

const METAL = { color: 0x8cabb5, metalness: 0.72, roughness: 0.32 };
const DARK = { color: 0x193440, metalness: 0.28, roughness: 0.61 };
const SHELL = { color: 0x456675, metalness: 0.48, roughness: 0.4 };
const CIRCUIT = { color: 0x296859, roughness: 0.62 };
const TEAL = { color: 0x67d6c3, metalness: 0.22, roughness: 0.35, emissive: 0x184c42 };
const WHITE = { color: 0xd8e5de, metalness: 0.12, roughness: 0.5 };

function buildMonitor(f: ModelFactory): void {
  // One half retains its screen layers; the other is a genuine teaching cutaway.
  // Full opaque planes would hide the boards in the initial viewing direction.
  f.box('panel', [1.1, 1.31, 0.12], [-0.572, 0.42, 0], DARK);
  f.box('panel', [1.1, 1.31, 0.028], [-0.572, 0.42, 0.075], { color: 0x122c37, metalness: 0.12, roughness: 0.22 });
  f.box('panel', [2.06, 1.12, 0.016], [0, 0.42, 0.098], { color: 0x377b87, emissive: 0x123c44, roughness: 0.3, opacity: 0.23 });
  for (const x of [-1.18, 1.18]) f.box('panel', [0.085, 1.45, 0.22], [x, 0.4, -0.045], SHELL);
  for (const y of [-0.31, 1.13]) f.box('panel', [2.45, 0.08, 0.22], [0, y, -0.045], SHELL);
  f.box('panel', [0.18, 0.55, 0.18], [0, -0.59, -0.08], METAL);
  f.box('panel', [1.05, 0.08, 0.66], [0, -0.91, 0.02], SHELL);
  f.box('panel', [2.34, 1.39, 0.025], [0, 0.4, -0.23], { color: 0x9edcd6, opacity: 0.12, roughness: 0.2 });
  // Light guide and multiple LED strips are visible at the edges of the cutaway.
  f.box('backlight', [1.08, 1.27, 0.035], [-0.572, 0.42, -0.09], { color: 0xc7e4dd, roughness: 0.45 });
  for (const x of [-1.1, 1.1]) {
    f.box('backlight', [0.047, 1.24, 0.04], [x, 0.42, -0.133], CIRCUIT);
    for (let i = 0; i < 10; i += 1) f.box('backlight', [0.048, 0.058, 0.04], [x, -0.12 + i * 0.12, -0.157], { color: 0xf2f4da, emissive: 0x79745b, roughness: 0.42 });
  }
  f.box('power', [0.68, 0.38, 0.08], [0.54, 0.12, -0.16], CIRCUIT);
  f.box('power', [0.18, 0.2, 0.075], [0.57, 0.15, -0.096], { color: 0xc2ad82, metalness: 0.38, roughness: 0.6 });
  for (const x of [0.28, 0.38]) f.cylinder('power', 0.038, 0.08, [x, 0.035, -0.084], METAL);
  f.cable('power', [[0.79, 0.18, -0.09], [0.87, 0.37, -0.1], [0.67, 0.5, -0.095]], 0.014, DARK);
  f.box('controller', [0.75, 0.47, 0.06], [0.54, 0.72, -0.16], CIRCUIT);
  f.box('controller', [0.2, 0.2, 0.05], [0.51, 0.77, -0.11], DARK);
  for (let i = 0; i < 3; i += 1) f.box('controller', [0.15, 0.07, 0.055], [0.31 + i * 0.2, 0.45, -0.09], METAL);
  f.cylinder('controller', 0.023, 0.018, [1.06, -0.3, 0.092], TEAL);
}

function buildProjector(f: ModelFactory): void {
  f.box('controller', [1.95, 0.08, 1.45], [0, -0.34, 0], SHELL);
  for (const x of [-0.92, 0.92]) f.box('controller', [0.08, 0.67, 1.45], [x, 0, 0], WHITE);
  f.box('controller', [1.95, 0.67, 0.065], [0, 0, -0.69], WHITE);
  f.box('controller', [0.81, 0.67, 0.065], [-0.53, 0, 0.69], WHITE);
  f.box('controller', [1.91, 0.025, 1.35], [0, 0.35, 0], { color: 0xa4e5df, opacity: 0.13, roughness: 0.2 });
  for (const x of [-0.74, 0.74]) for (const z of [-0.5, 0.5]) f.cylinder('controller', 0.09, 0.08, [x, -0.41, z], DARK, [0, 0, 0]);
  f.box('controller', [0.6, 0.06, 0.8], [-0.53, -0.19, -0.08], CIRCUIT);
  f.box('controller', [0.23, 0.055, 0.24], [-0.56, -0.125, -0.05], DARK);
  for (let i = 0; i < 3; i += 1) f.box('controller', [0.28, 0.11, 0.048], [-0.5 + i * 0.39, -0.04, -0.748], DARK);
  f.cylinder('controller', 0.06, 0.025, [-0.63, 0.37, 0.43], TEAL, [0, 0, 0]);
  // Optical barrel is genuinely cylindrical and projects beyond the body.
  f.cylinder('optics', 0.3, 0.58, [0.48, 0.03, 0.63], DARK);
  f.ring('optics', 0.3, 0.033, [0.48, 0.03, 0.93], METAL);
  f.ring('optics', 0.22, 0.025, [0.48, 0.03, 0.95], TEAL);
  f.sphere('optics', 0.2, [0.48, 0.03, 0.943], { color: 0x8be0e1, opacity: 0.55, metalness: 0.12, roughness: 0.18 }, [1, 1, 0.3]);
  f.box('optics', [0.5, 0.26, 0.27], [0.46, -0.1, 0.12], METAL);
  f.cylinder('source', 0.23, 0.44, [0.4, -0.04, -0.31], { color: 0xb4b8a5, metalness: 0.7, roughness: 0.32 });
  f.cylinder('source', 0.115, 0.14, [0.4, -0.04, -0.03], { color: 0xf2e6b7, emissive: 0xb68133, roughness: 0.35 });
  for (let i = 0; i < 7; i += 1) f.box('source', [0.54, 0.026, 0.52], [0.4, -0.24 + i * 0.066, -0.33], METAL);
  f.cylinder('cooling', 0.24, 0.12, [-0.54, 0.02, 0.49], DARK);
  f.ring('cooling', 0.24, 0.027, [-0.54, 0.02, 0.56], METAL);
  f.cylinder('cooling', 0.068, 0.04, [-0.54, 0.02, 0.575], TEAL);
  for (let i = 0; i < 7; i += 1) {
    const angle = i / 7 * Math.PI * 2;
    f.box('cooling', [0.13, 0.06, 0.025], [-0.54 + Math.cos(angle) * 0.13, 0.02 + Math.sin(angle) * 0.13, 0.568], SHELL, [0, 0, angle + 0.4]);
  }
}

function buildLamp(f: ModelFactory): void {
  f.box('led', [2.45, 0.14, 0.67], [0, 0.12, 0], WHITE);
  for (const z of [-0.3, 0.3]) f.box('led', [2.36, 0.085, 0.07], [0, 0.025, z], METAL);
  f.box('led', [2.25, 0.034, 0.49], [0, 0.014, 0], CIRCUIT);
  for (let i = 0; i < 12; i += 1) for (const z of [-0.14, 0.14]) {
    f.box('led', [0.108, 0.025, 0.09], [-1.025 + i * 0.186, -0.018, z], { color: 0xf4f3d2, emissive: 0x8c8b58, roughness: 0.35 });
  }
  // Transparent diffuser allows examining the underlying emitters.
  f.box('led', [2.3, 0.095, 0.52], [0, -0.079, 0], { color: 0xd7f0e6, opacity: 0.23, roughness: 0.3 });
  f.box('driver', [0.75, 0.17, 0.34], [-0.37, 0.25, 0], SHELL);
  for (let i = 0; i < 5; i += 1) f.box('driver', [0.023, 0.13, 0.29], [-0.61 + i * 0.12, 0.26, 0], METAL);
  f.cable('driver', [[0.015, 0.26, 0], [0.17, 0.23, 0.06], [0.18, 0.09, 0.18]], 0.014, DARK);
  f.box('control', [0.36, 0.145, 0.28], [0.56, 0.24, 0], CIRCUIT);
  f.box('control', [0.14, 0.045, 0.14], [0.53, 0.325, 0], DARK);
  for (const x of [-0.97, 0.97]) {
    f.box('control', [0.12, 0.28, 0.06], [x, 0.27, -0.23], METAL);
    f.box('control', [0.25, 0.055, 0.3], [x, 0.43, -0.1], METAL);
  }
  // Two local suspension rods add readable depth while keeping a compact model.
  for (const x of [-0.97, 0.97]) f.cylinder('control', 0.012, 0.55, [x, 0.72, -0.12], DARK, [0, 0, 0]);
}

function buildFridge(f: ModelFactory): void {
  // Open cabinet and swung door expose shelves, insulation and the cooling chain.
  f.box('cabinet', [1.42, 0.11, 1.23], [0, -1.17, 0], WHITE);
  f.box('cabinet', [1.42, 0.11, 1.23], [0, 1.17, 0], WHITE);
  for (const x of [-0.66, 0.66]) f.box('cabinet', [0.11, 2.3, 1.23], [x, 0, 0], WHITE);
  f.box('cabinet', [1.24, 2.27, 0.08], [0, 0, -0.57], WHITE);
  f.box('cabinet', [1.18, 2.12, 0.027], [0, 0.03, -0.514], { color: 0xa4c2be, roughness: 0.57 });
  for (const y of [-0.71, -0.16, 0.38, 0.86]) {
    f.box('cabinet', [1.2, 0.028, 0.97], [0, y, 0.015], { color: 0xb6ded6, opacity: 0.38, roughness: 0.22 });
    f.box('cabinet', [1.2, 0.04, 0.035], [0, y - 0.016, 0.5], METAL);
  }
  f.box('cabinet', [1.24, 0.34, 0.82], [0, -0.98, 0.06], { color: 0xd4e7da, opacity: 0.48, roughness: 0.32 });
  const angle = Math.PI / 3;
  const doorCenter: [number, number, number] = [0.66 + Math.cos(angle) * 0.66, 0, 0.56 + Math.sin(angle) * 0.66];
  f.box('cabinet', [1.34, 2.32, 0.11], doorCenter, WHITE, [0, -angle, 0]);
  f.box('cabinet', [1.19, 2.17, 0.035], [doorCenter[0] - 0.033, 0, doorCenter[2] + 0.019], DARK, [0, -angle, 0]);
  f.box('cabinet', [0.06, 0.62, 0.08], [1.18, 0.07, 1.68], METAL);
  for (const x of [-0.53, 0.53]) for (const z of [-0.43, 0.43]) f.cylinder('cabinet', 0.065, 0.1, [x, -1.27, z], DARK, [0, 0, 0]);
  f.sphere('compressor', 0.26, [0.18, -1.02, -0.66], { color: 0x294450, metalness: 0.7, roughness: 0.4 }, [1.25, 0.85, 0.85]);
  f.box('compressor', [0.67, 0.06, 0.45], [0.18, -1.25, -0.66], DARK);
  for (let i = 0; i < 9; i += 1) f.cylinder('compressor', 0.018, 0.94, [0, -0.66 + i * 0.18, -0.673], DARK, [0, 0, Math.PI / 2]);
  for (const x of [-0.43, 0.43]) f.cylinder('compressor', 0.018, 1.47, [x, 0.06, -0.673], DARK, [0, 0, 0]);
  f.cable('compressor', [[0.4, -1.02, -0.68], [0.5, -0.78, -0.7], [0.45, -0.66, -0.673]], 0.025, { color: 0xb18157, metalness: 0.72, roughness: 0.38 });
  f.cylinder('circulation', 0.17, 0.065, [0, 0.91, -0.454], DARK);
  f.ring('circulation', 0.17, 0.02, [0, 0.91, -0.411], METAL);
  f.cylinder('circulation', 0.045, 0.025, [0, 0.91, -0.4], TEAL);
  for (let i = 0; i < 6; i += 1) {
    const a = i / 6 * Math.PI * 2;
    f.box('circulation', [0.085, 0.04, 0.021], [Math.cos(a) * 0.092, 0.91 + Math.sin(a) * 0.092, -0.412], SHELL, [0, 0, a + 0.4]);
  }
  f.box('control', [0.35, 0.16, 0.085], [-0.39, 1.025, 0.54], DARK);
  f.box('control', [0.23, 0.08, 0.009], [-0.42, 1.028, 0.59], TEAL);
  f.cylinder('control', 0.035, 0.027, [-0.25, 1.027, 0.59], METAL);
}

function buildRadiator(f: ModelFactory): void {
  for (let i = 0; i < 11; i += 1) {
    const x = -1 + i * 0.2;
    f.box('body', [0.145, 1.31, 0.39], [x, 0.11, 0], WHITE);
    f.box('body', [0.08, 1.1, 0.48], [x, 0.09, 0.01], { color: 0xbbd0cd, metalness: 0.3, roughness: 0.42 });
    for (const y of [-0.49, 0.7]) f.sphere('body', 0.073, [x, y, 0], WHITE, [1, 1, 2.6]);
  }
  for (const y of [-0.43, 0.65]) f.cylinder('body', 0.095, 2.24, [0, y, 0.01], WHITE, [0, 0, Math.PI / 2]);
  f.cylinder('pipes', 0.062, 0.88, [-1.35, -0.05, -0.09], METAL, [0, 0, 0]);
  f.cylinder('pipes', 0.062, 0.54, [-1.1, 0.37, -0.09], METAL, [0, 0, Math.PI / 2]);
  f.cylinder('pipes', 0.055, 0.5, [1.29, -0.65, 0], METAL, [0, 0, 0]);
  f.cylinder('pipes', 0.055, 0.34, [1.18, -0.43, 0], METAL, [0, 0, Math.PI / 2]);
  f.box('pipes', [0.2, 0.04, 0.24], [-1.35, -0.52, -0.09], DARK);
  f.box('pipes', [0.2, 0.04, 0.24], [1.29, -0.92, 0], DARK);
  f.cylinder('valve', 0.12, 0.22, [-1.16, 0.66, 0.01], METAL, [0, 0, Math.PI / 2]);
  f.cylinder('valve', 0.13, 0.22, [-1.38, 0.66, 0.01], WHITE, [0, 0, Math.PI / 2]);
  f.cylinder('valve', 0.09, 0.012, [-1.497, 0.66, 0.01], DARK, [0, 0, Math.PI / 2]);
  for (let i = 0; i < 8; i += 1) {
    const a = i / 8 * Math.PI * 2;
    f.box('valve', [0.17, 0.028, 0.028], [-1.38, 0.66 + Math.cos(a) * 0.129, 0.01 + Math.sin(a) * 0.129], METAL, [a, 0, 0]);
  }
  f.box('valve', [0.05, 0.047, 0.018], [-1.38, 0.81, 0.01], TEAL);
}

function buildWindow(f: ModelFactory): void {
  for (const x of [-1.05, 1.05]) f.box('frame', [0.15, 2.35, 0.24], [x, 0, 0], WHITE);
  for (const y of [-1.1, 1.1]) f.box('frame', [2.15, 0.15, 0.24], [0, y, 0], WHITE);
  f.box('frame', [0.1, 2.2, 0.22], [0, 0, 0], WHITE);
  f.box('frame', [2.43, 0.09, 0.52], [0, -1.22, 0.12], { color: 0xaccac9, roughness: 0.42 });
  for (const x of [-0.527, 0.527]) {
    for (const z of [-0.055, 0.055]) f.box('glass', [0.895, 2.03, 0.013], [x, 0, z], { color: 0x83c3d1, opacity: 0.29, metalness: 0.18, roughness: 0.16 });
    // Opaque thin spacing profiles are part of the glass unit and are selectable.
    for (const y of [-0.994, 0.994]) f.box('glass', [0.89, 0.02, 0.087], [x, y, 0], METAL);
    for (const edge of [-0.444, 0.444]) f.box('seal', [0.023, 2.05, 0.046], [x + edge, 0, 0.086], DARK);
    for (const y of [-1.016, 1.016]) f.box('seal', [0.91, 0.023, 0.046], [x, y, 0.086], DARK);
  }
  f.box('handle', [0.055, 0.2, 0.055], [0.092, -0.1, 0.15], METAL);
  f.box('handle', [0.052, 0.25, 0.07], [0.095, -0.16, 0.23], METAL);
  f.cylinder('handle', 0.038, 0.105, [0.095, -0.062, 0.178], TEAL);
  for (const y of [-0.79, 0.79]) f.cylinder('handle', 0.037, 0.14, [1.048, y, 0.15], METAL, [0, 0, 0]);
}

function buildNetwork(f: ModelFactory): void {
  f.box('processor', [2.24, 0.07, 1.18], [0, -0.21, 0], SHELL);
  for (const x of [-1.08, 1.08]) f.box('processor', [0.08, 0.45, 1.18], [x, 0, 0], SHELL);
  f.box('processor', [2.24, 0.45, 0.045], [0, 0, -0.57], SHELL);
  f.box('processor', [2.18, 0.019, 1.1], [0, 0.24, 0], { color: 0xa0dbd5, opacity: 0.13, roughness: 0.25 });
  f.box('processor', [1.34, 0.035, 0.9], [-0.27, -0.145, -0.04], CIRCUIT);
  f.box('processor', [0.34, 0.085, 0.32], [-0.28, -0.073, -0.16], DARK);
  for (let i = 0; i < 6; i += 1) f.box('processor', [0.027, 0.15, 0.35], [-0.43 + i * 0.06, 0.048, -0.16], METAL);
  for (let i = 0; i < 4; i += 1) f.box('processor', [0.13, 0.075, 0.19], [-0.82 + i * 0.18, -0.089, 0.28], DARK);
  for (const x of [-0.9, 0.9]) for (const z of [-0.39, 0.39]) f.cylinder('processor', 0.07, 0.09, [x, -0.29, z], DARK, [0, 0, 0]);
  // Eight recessed ports, each with real pins and status LEDs.
  f.box('ports', [2.17, 0.38, 0.05], [0, -0.004, 0.571], METAL);
  for (let i = 0; i < 8; i += 1) {
    const x = -0.9 + i * 0.257;
    f.box('ports', [0.2, 0.16, 0.14], [x, -0.013, 0.61], DARK);
    for (let j = 0; j < 4; j += 1) f.box('ports', [0.009, 0.047, 0.023], [x - 0.054 + j * 0.036, -0.013, 0.69], { color: 0xc8b76d, metalness: 0.75, roughness: 0.32 });
    f.box('ports', [0.026, 0.021, 0.015], [x - 0.066, 0.125, 0.607], TEAL);
  }
  f.box('power', [0.44, 0.25, 0.7], [0.72, -0.038, -0.035], { color: 0x364851, metalness: 0.4, roughness: 0.48 });
  for (let i = 0; i < 5; i += 1) f.box('power', [0.34, 0.012, 0.021], [0.72, -0.12 + i * 0.045, 0.321], DARK);
  f.box('power', [0.13, 0.15, 0.055], [0.82, -0.025, -0.616], DARK);
  f.cable('power', [[0.49, -0.05, -0.14], [0.36, 0.026, -0.4], [-0.02, 0.024, -0.38]], 0.015, TEAL);
}

function buildSensor(f: ModelFactory): void {
  f.box('mount', [0.95, 0.95, 0.16], [0, 0, -0.25], WHITE);
  f.box('mount', [0.86, 0.85, 0.085], [0, 0, -0.14], WHITE);
  for (const x of [-0.36, 0.36]) for (const y of [-0.36, 0.36]) f.cylinder('mount', 0.031, 0.013, [x, y, -0.087], METAL);
  f.ring('lens', 0.303, 0.035, [0, -0.033, 0.08], DARK);
  f.ring('lens', 0.335, 0.035, [0, -0.033, 0.119], WHITE);
  f.sphere('lens', 0.3, [0, -0.033, 0.137], { color: 0xcae8db, opacity: 0.5, roughness: 0.47 }, [1, 1, 0.66]);
  // Ribbed Fresnel surface remains a small collection of real low-poly meshes.
  for (let i = 0; i < 4; i += 1) {
    const radius = 0.072 + i * 0.055;
    const z = 0.137 + 0.198 * Math.sqrt(1 - (radius / 0.3) ** 2);
    f.ring('lens', radius, 0.007, [0, -0.033, z], { color: 0x92bbae, roughness: 0.49 });
  }
  f.box('board', [0.58, 0.57, 0.035], [0, 0.035, -0.065], CIRCUIT);
  f.cylinder('board', 0.062, 0.037, [0, -0.032, 0.007], METAL);
  f.box('board', [0.15, 0.095, 0.044], [-0.155, 0.24, -0.027], DARK);
  f.box('board', [0.12, 0.042, 0.036], [0.179, 0.207, -0.024], METAL);
  f.cylinder('board', 0.026, 0.022, [0.28, 0.33, 0.005], TEAL);
  f.box('mount', [0.95, 0.11, 0.21], [0, 0.42, -0.057], WHITE);
}

function buildVentilation(f: ModelFactory): void {
  // Kitchen hood: an open upper plenum, visible blower and separate lower filter.
  f.box('filter', [2.17, 0.085, 1.33], [0, -0.68, 0], METAL);
  for (const x of [-1.04, 1.04]) f.box('filter', [0.09, 0.36, 1.33], [x, -0.53, 0], SHELL);
  f.box('filter', [2.17, 0.36, 0.075], [0, -0.53, -0.626], SHELL);
  f.box('filter', [2.17, 0.095, 0.07], [0, -0.36, 0.625], METAL);
  for (const x of [-0.52, 0.52]) {
    f.box('filter', [0.95, 0.025, 1.12], [x, -0.73, 0], DARK);
    for (let i = 0; i < 12; i += 1) f.box('filter', [0.024, 0.023, 1.1], [x - 0.414 + i * 0.075, -0.757, 0], METAL);
    for (const z of [-0.32, 0, 0.32]) f.box('filter', [0.9, 0.015, 0.018], [x, -0.775, z], METAL);
  }
  for (const x of [-0.41, 0.41]) f.box('filter', [0.047, 1.15, 0.72], [x, 0.33, -0.11], METAL);
  f.box('filter', [0.79, 1.15, 0.047], [0, 0.33, -0.449], METAL);
  f.box('filter', [0.79, 1.1, 0.023], [0, 0.33, 0.25], { color: 0x9ad5d0, opacity: 0.13, roughness: 0.22 });
  f.box('filter', [0.91, 0.065, 0.82], [0, 0.93, -0.1], METAL);
  f.cylinder('motor', 0.31, 0.24, [0, -0.15, 0.063], DARK);
  f.ring('motor', 0.33, 0.027, [0, -0.15, 0.203], METAL);
  f.cylinder('motor', 0.11, 0.11, [0, -0.15, 0.212], TEAL);
  for (let i = 0; i < 8; i += 1) {
    const a = i / 8 * Math.PI * 2;
    f.box('motor', [0.16, 0.065, 0.033], [Math.cos(a) * 0.185, -0.15 + Math.sin(a) * 0.185, 0.22], SHELL, [0, 0, a + 0.55]);
  }
  f.cylinder('motor', 0.11, 0.31, [0, -0.15, -0.201], { color: 0x697e88, metalness: 0.7, roughness: 0.36 });
  for (const x of [-0.16, 0.16]) f.box('motor', [0.05, 0.1, 0.33], [x, -0.35, -0.064], METAL);
  f.box('control', [0.46, 0.155, 0.05], [0.68, -0.512, 0.64], DARK);
  for (let i = 0; i < 3; i += 1) f.cylinder('control', 0.036, 0.025, [0.545 + i * 0.134, -0.511, 0.679], i === 0 ? TEAL : METAL);
  f.box('control', [0.25, 0.044, 0.27], [0.67, -0.469, 0.25], CIRCUIT);
  f.cable('control', [[0.57, -0.44, 0.22], [0.39, -0.35, -0.16], [0.05, -0.25, -0.25]], 0.014, TEAL);
}
