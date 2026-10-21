const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Existing HealthVault compatibility (local chain only)', function () {
  it('emits upload/grant/revoke events and rejects revoked access and uploads', async function () {
    const [patient, doctor] = await ethers.getSigners();
    const vault = await (await ethers.getContractFactory('HealthVault', patient)).deploy();
    await vault.waitForDeployment();
    await expect(vault.grantAccess(doctor.address)).to.emit(vault, 'AccessGranted').withArgs(patient.address, doctor.address);
    await expect(vault.connect(doctor).uploadRecordFor(patient.address, 'test-cid')).to.emit(vault, 'RecordUploaded').withArgs(patient.address, 'test-cid');
    expect(await vault.connect(doctor).getRecord(patient.address)).to.equal('test-cid');
    await expect(vault.revokeAccess(doctor.address)).to.emit(vault, 'AccessRevoked').withArgs(patient.address, doctor.address);
    expect(await vault.hasAccess(patient.address, doctor.address)).to.equal(false);
    await expect(vault.connect(doctor).getRecord(patient.address)).to.be.revertedWith('Access denied');
    await expect(vault.connect(doctor).uploadRecordFor(patient.address, 'denied')).to.be.revertedWith('Access denied');
  });
});
