/**
 * @file electron/hidTransport.ts
 * @description Native desktop USB HID transport (`node-hid`) for the HIROYASU IC-980 Pro Max
 * (`VendorName = "ASER _HID"`, `ProductName = "ASER-471"`).
 * Dynamically imports `node-hid` when available on Windows, macOS, and Linux.
 */

export interface NativeHidDeviceDescriptor {
  vendorId: number;
  productId: number;
  manufacturer?: string;
  product?: string;
  path?: string;
}

interface NodeHidModule {
  default: {
    devices: () => NativeHidDeviceDescriptor[];
  };
}

/**
 * Enumerates connected USB HID devices matching the HIROYASU IC-980 Pro Max (`ASER _HID` / `ASER-471`).
 * Falls back gracefully to an empty list if `node-hid` is not installed (allowing WebHID fallback).
 */
export async function enumerateAserHidDevices(): Promise<NativeHidDeviceDescriptor[]> {
  try {
    const moduleName = 'node-hid';
    const nodeHid = (await import(moduleName)) as unknown as NodeHidModule;
    const allDevices = nodeHid.default.devices();
    return allDevices
      .filter(
        (d: NativeHidDeviceDescriptor) =>
          (d.manufacturer && d.manufacturer.includes('ASER')) ||
          (d.product && d.product.includes('ASER-471'))
      )
      .map((d: NativeHidDeviceDescriptor) => ({
        vendorId: d.vendorId,
        productId: d.productId,
        manufacturer: d.manufacturer,
        product: d.product,
        path: d.path,
      }));
  } catch {
    return [];
  }
}
