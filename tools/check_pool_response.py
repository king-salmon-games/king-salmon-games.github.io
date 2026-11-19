"""Check gravity-wave travel, interference and boundaries in the pool's solver.

Run `python tools/check_pool_response.py` with the dependencies of the pool bake.
"""

import numpy as np
from bake_pool_response import GRAVITY, integrate

CELL, DT = .08, 1 / 128
X = np.arange(160) * CELL
WET = np.ones((4, len(X)), dtype=bool)


def packet(center, direction, depth):
    """Linear right- or left-going Gaussian, staggered in space and time."""
    speed = np.sqrt(GRAVITY * depth)

    def elevation(position):
        return np.broadcast_to(.04 * np.exp(-.5 * ((position - center) / .32) ** 2), WET.shape)

    height = elevation(X)
    face = X - .5 * CELL + direction * speed * DT / 2
    velocity = (direction * speed / depth) * elevation(face)
    return height, velocity, np.zeros_like(height)


def run(initial, depth=.4, wet=WET, edges=(), seconds=4, pressure=0):
    return integrate(wet, np.full(wet.shape, depth), 0., pressure, round(seconds / DT),
                     cell=CELL, dt=DT, stride=1, initial=initial, open_edges=edges)


def check():
    for depth in (.25, .80):
        wave = run(packet(3., 1, depth), depth=depth, seconds=3)
        t1, t2 = wave[:, 1, 60].argmax(), wave[:, 1, 85].argmax()
        measured = 25 * CELL / ((t2 - t1) * DT)
        assert abs(measured / np.sqrt(GRAVITY * depth) - 1) < .035, measured

    left, right = packet(4., 1, .4), packet(8., -1, .4)
    wave_l, wave_r = run(left), run(right)
    for sign in (1, -1):
        combined = run(tuple(a + sign * b for a, b in zip(left, right)))
        np.testing.assert_allclose(combined, wave_l + sign * wave_r, atol=2e-13)
        center = round(6. / CELL)
        crossing = round(2. / np.sqrt(.4 * GRAVITY) / DT)
        if sign > 0:
            assert combined[crossing, 1, center] > .075
        else:
            assert abs(combined[crossing, 1, center]) < .001

    pulse = packet(5., 1, .4)
    dry_wall = WET.copy()
    dry_wall[:, 125] = False
    walled = run(pulse, wet=dry_wall, seconds=6)
    assert np.max(np.abs(walled[:, :, 125:])) < 1e-13
    # The crest hits the gauge at x=8, reflects off the face at x=9.96,
    # and passes the same gauge again after the incoming packet has left.
    gauge = walled[:, 1, 100]
    reflected = gauge[round(3.15 / DT):round(3.9 / DT)].max()
    assert .90 < reflected / gauge[:round(2.2 / DT)].max() < 1.06
    open_channel = run(pulse, edges=("east",), seconds=8)
    assert np.max(np.abs(open_channel[round(6.5 / DT):, 1, 100])) < .002

    # A pressure impulse exchanges momentum with the pool. It must conserve
    # the volume of a closed basin, including after the forcing has ended.
    pressure = np.broadcast_to(.12 * np.exp(-((X - 5.) / .45) ** 2), WET.shape)
    from_rest = run(None, wet=dry_wall, pressure=pressure)
    assert np.max(np.abs(from_rest.sum(axis=(1, 2)) * CELL ** 2)) < 1.e-12
    print("Wave speed, signed crossing, bank reflection, open outflow and closed-basin mass passed.")


if __name__ == "__main__":
    check()
