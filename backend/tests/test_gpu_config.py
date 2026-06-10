import importlib
import os
import sys
import unittest
from unittest.mock import patch

from pydantic import ValidationError


BASE_ENV = {
    "DISCORD_CLIENT_ID": "discord-client-id",
    "DISCORD_CLIENT_SECRET": "discord-client-secret",
    "NEXTAUTH_SECRET": "nextauth-secret",
    "NEXTAUTH_URL": "http://localhost:3000",
    "INTERNAL_API_SECRET": "internal-secret",
    "MONGODB_URI": "mongodb://localhost:27017/pve_vm_panel_test",
    "PVE_HOST": "https://pve.example.test:8006",
    "PVE_NODE": "pve",
    "PVE_TOKEN_ID": "root@pam!panel",
    "PVE_TOKEN_SECRET": "secret",
    "VM_STORAGE": "local-lvm",
    "VM_BRIDGE": "vmbr0",
    "VM_IP_RANGE": "10.10.0.0/24",
    "VM_GATEWAY": "10.10.0.1",
    "VM_DNS": "1.1.1.1",
    "RESOURCE_LIMIT_CPU": "32",
    "RESOURCE_LIMIT_RAM_GB": "128",
    "RESOURCE_LIMIT_DISK_GB": "2000",
    "PRICE_CPU_CORE_HOUR": "1",
    "PRICE_RAM_GB_HOUR": "2",
    "PRICE_DISK_GB_HOUR": "0",
    "PRICE_GPU_HOUR": "20",
}


class GPUConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env_patcher = patch.dict(os.environ, BASE_ENV, clear=False)
        self.env_patcher.start()
        sys.modules.pop("config", None)
        self.config_module = importlib.import_module("config")

    def tearDown(self) -> None:
        sys.modules.pop("config", None)
        sys.modules.pop("services.vm_lifecycle", None)
        self.env_patcher.stop()

    def test_gpu_pool_accepts_short_pci_id(self) -> None:
        settings = self.config_module.Settings(
            RESOURCE_GPU_POOL='[{"id":"RTX3090","pci_id":"61:00.0"}]'
        )

        self.assertEqual(
            settings.RESOURCE_GPU_POOL,
            [
                {
                    "id": "RTX3090",
                    "pci_id": "0000:61:00.0",
                    "pci_ids": ["0000:61:00.0"],
                    "hostpci_slots": ["0000:61:00"],
                    "hostpci_options": ["pcie=1,x-vga=1"],
                }
            ],
        )

    def test_gpu_pool_groups_multifunction_devices(self) -> None:
        settings = self.config_module.Settings(
            RESOURCE_GPU_POOL=(
                '[{"id":"RTX3090","pci_ids":["61:00.0","61:00.1"],'
                '"hostpci_options":"pcie=1,x-vga=1"}]'
            )
        )

        gpu = settings.RESOURCE_GPU_POOL[0]
        self.assertEqual(gpu["pci_ids"], ["0000:61:00.0", "0000:61:00.1"])
        self.assertEqual(gpu["hostpci_slots"], ["0000:61:00"])
        self.assertEqual(gpu["hostpci_options"], ["pcie=1,x-vga=1"])

    def test_gpu_pool_rejects_bad_pci_id(self) -> None:
        with self.assertRaisesRegex(ValidationError, "Invalid PCI ID"):
            self.config_module.Settings(
                RESOURCE_GPU_POOL='[{"id":"bad","pci_id":"not-a-pci-id"}]'
            )

    def test_gpu_hostpci_config_uses_slot_root(self) -> None:
        sys.modules.pop("services.vm_lifecycle", None)
        vm_lifecycle = importlib.import_module("services.vm_lifecycle")

        config = vm_lifecycle._gpu_hostpci_config(
            {
                "pci_id": "0000:61:00.0",
                "pci_ids": ["0000:61:00.0", "0000:61:00.1"],
                "hostpci_slots": ["0000:61:00"],
                "hostpci_options": ["pcie=1,x-vga=1"],
            }
        )

        self.assertEqual(config, {"hostpci0": "0000:61:00,pcie=1,x-vga=1"})


if __name__ == "__main__":
    unittest.main()
