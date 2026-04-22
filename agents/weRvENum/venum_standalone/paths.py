from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = PACKAGE_DIR.parent
REPO_ROOT = PROJECT_DIR.parent.parent
CONFIG_DIR = PROJECT_DIR / "config"
RUNTIME_DIR = PROJECT_DIR / "runtime"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)


def config_file(name: str) -> Path:
    return CONFIG_DIR / name


def runtime_file(name: str) -> Path:
    return RUNTIME_DIR / name
