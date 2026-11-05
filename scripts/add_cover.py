#!/usr/bin/env python3
"""快捷入库: add_cover.py <image> --title T [--category C] [--note N] [--source S] [--tags a,b]
等价于 manage.py add ..."""
import os, sys, runpy
sys.argv = [sys.argv[0], "add"] + sys.argv[1:]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "manage.py"), run_name="__main__")
